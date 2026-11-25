package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mcpjungle/mcpjungle/internal/model"
	"github.com/mcpjungle/mcpjungle/internal/telemetry"
	"github.com/mcpjungle/mcpjungle/pkg/apierrors"
	"github.com/mcpjungle/mcpjungle/pkg/types"
	"gorm.io/gorm"
)

// ToolDeletionCallback is a function type that can be registered to be called
// whenever one or more tools are deleted (deregistered) or disabled.
// The callback receives the names of the deleted tools as arguments.
type ToolDeletionCallback func(toolNames ...string)

// ToolAdditionCallback is a function type that can be registered to be called
// whenever a tool is added (registered or re-enabled).
// The callback receives the name of the added tool as argument.
type ToolAdditionCallback func(toolName string) error

// ListTools returns all tools registered in the registry.
// It sets each tool's name to its canonical form by prepending its mcp server's name.
// For example, if a tool named "commit" is provided by a server named "git",
// its name will be set to "git__commit".
func (m *MCPService) ListTools() ([]model.Tool, error) {
	var tools []model.Tool
	if err := m.db.Find(&tools).Error; err != nil {
		return nil, err
	}
	// prepend server name to tool names to ensure we only return the unique names of tools to user
	for i := range tools {
		var s model.McpServer
		if err := m.db.First(&s, "id = ?", tools[i].ServerID).Error; err != nil {
			return nil, fmt.Errorf("failed to get server for tool %s: %w", tools[i].Name, err)
		}
		tools[i].Name = mergeServerToolNames(s.Name, tools[i].Name)
	}
	return tools, nil
}

// ListToolsByServer fetches tools provided by an MCP server from the registry.
func (m *MCPService) ListToolsByServer(name string) ([]model.Tool, error) {
	if err := validateServerName(name); err != nil {
		return nil, err
	}

	s, err := m.GetMcpServer(name)
	if err != nil {
		return nil, fmt.Errorf("failed to get MCP server %s from DB: %w", name, err)
	}

	var tools []model.Tool
	if err := m.db.Where("server_id = ?", s.ID).Find(&tools).Error; err != nil {
		return nil, fmt.Errorf("failed to get tools for server %s from DB: %w", name, err)
	}

	// prepend server name to tool names to ensure we only return the unique names of tools to user
	for i := range tools {
		tools[i].Name = mergeServerToolNames(s.Name, tools[i].Name)
	}

	return tools, nil
}

func (m *MCPService) GetTool(name string) (*model.Tool, error) {
	serverName, toolName, ok := splitServerToolName(name)
	if !ok {
		return nil, fmt.Errorf("tool name does not contain a %s separator: %w", serverToolNameSep, apierrors.ErrInvalidInput)
	}

	s, err := m.GetMcpServer(serverName)
	if err != nil {
		return nil, fmt.Errorf("failed to get MCP server %s from DB: %w", serverName, err)
	}

	var tool model.Tool
	if err := m.db.Where("server_id = ? AND name = ?", s.ID, toolName).First(&tool).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("tool %s not found: %w", name, apierrors.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to get tool %s from DB: %w", name, err)
	}
	// set the tool name back to its canonical form
	tool.Name = name
	return &tool, nil
}

// GetToolInstance returns the in-memory mcp.Tool instance for the given tool name.
// Returns the tool instance and a boolean indicating if it was found.
func (m *MCPService) GetToolInstance(name string) (mcp.Tool, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	tool, exists := m.toolInstances[name]
	return tool, exists
}

// GetToolParentServer returns the MCP server that provides the given tool.
// The input name must be the canonical tool name, ie, it must contain the server name prefix (eg- "server__tool").
func (m *MCPService) GetToolParentServer(name string) (*model.McpServer, error) {
	serverName, _, ok := splitServerToolName(name)
	if !ok {
		return nil, fmt.Errorf("tool name does not contain a %s separator: %w", serverToolNameSep, apierrors.ErrInvalidInput)
	}
	return m.GetMcpServer(serverName)
}

// InvokeTool invokes a tool from a registered MCP server and returns its response.
func (m *MCPService) InvokeTool(ctx context.Context, name string, args map[string]any) (*types.ToolInvokeResult, error) {
	started := time.Now()
	outcome := telemetry.ToolCallOutcomeError

	serverName, toolName, ok := splitServerToolName(name)
	if !ok {
		return nil, fmt.Errorf("tool name does not contain a %s separator: %w", serverToolNameSep, apierrors.ErrInvalidInput)
	}

	// record the tool call metrics when the function returns
	defer func() {
		m.metrics.RecordToolCall(ctx, serverName, toolName, outcome, time.Since(started))
	}()

	serverModel, err := m.GetMcpServer(serverName)
	if err != nil {
		return nil, fmt.Errorf(
			"failed to get details about MCP server %s from DB: %w",
			serverName,
			err,
		)
	}
	tool, err := m.GetTool(name)
	if err != nil {
		return nil, err
	}
	if !tool.Enabled {
		return nil, fmt.Errorf("tool %s is disabled: %w", name, apierrors.ErrInvalidInput)
	}

	callToolResp, err := m.callTool(ctx, serverModel, toolRequest(toolName, args))
	if err != nil {
		return nil, fmt.Errorf("failed to call tool %s on MCP server %s: %w", toolName, serverName, err)
	}
	m.signIns.observe(serverModel, callToolResp, time.Now())

	// NOTE: callToolResp.Content is a list of Content objects.
	// If the tool returns a list as its result, it gets converted to a list of Content objects.
	// But if the tool returns any other type of object (string, map, number, etc), then it is
	// completely available in Content[0].

	// Convert MCP response to ToolInvokeResult
	result, err := m.convertToolCallResToAPIRes(callToolResp)
	if err != nil {
		return nil, fmt.Errorf("failed to convert MCP response to api response: %w", err)
	}

	outcome = telemetry.ToolCallOutcomeSuccess

	return result, nil
}

// callTool sends one tool call, named as the upstream knows it, to the server's upstream.
func (m *MCPService) callTool(ctx context.Context, s *model.McpServer, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	session, err := m.getSession(ctx, s)
	if err != nil {
		return nil, err
	}
	defer session.closeIfApplicable()

	res, err := session.client.CallTool(ctx, req)
	if err != nil {
		session.invalidateOnError(err) // Invalidate unhealthy stateful sessions
		return nil, err
	}
	return res, nil
}

// SetToolDeletionCallback registers a callback function to be called
// whenever one or more tools are deleted (deregistered) or disabled.
// The callback receives the names of the deleted tools as arguments.
func (m *MCPService) SetToolDeletionCallback(callback ToolDeletionCallback) {
	m.toolDeletionCallback = callback
}

// SetToolAdditionCallback registers a callback function to be called
// whenever one or more tools are added (registered or re-enabled).
// The callback receives the name of the added tool as argument.
func (m *MCPService) SetToolAdditionCallback(callback ToolAdditionCallback) {
	m.toolAdditionCallback = callback
}

// EnableTools enables one or more tools.
// If the entity is a tool name, only that tool is enabled.
// If the entity is a server name, all tools of that server are enabled.
// The function returns a list of enabled tool names.
// If the tool or server does not exist, it returns an error.
// If the tool is already enabled, it returns the tool name without an error.
func (m *MCPService) EnableTools(entity string) ([]string, error) {
	return m.setToolsEnabled(entity, true)
}

// DisableTools disables one or more tools.
// If the entity is a tool name, only that tool is disabled.
// If the entity is a server name, all tools of that server are disabled.
// The function returns a list of disabled tool names.
// If the tool or server does not exist, it returns an error.
// If the tool is already disabled, it returns the tool name without an error.
func (m *MCPService) DisableTools(entity string) ([]string, error) {
	return m.setToolsEnabled(entity, false)
}

// setToolsEnabled does the heavy lifting of enabling or disabling one or more tools.
// entity can be either a tool name or a server name.
// If entity is a tool name, only that tool is enabled/disabled.
// If entity is a server name, all tools of that server are enabled/disabled.
func (m *MCPService) setToolsEnabled(entity string, enabled bool) ([]string, error) {
	serverName, toolName, ok := splitServerToolName(entity)
	if ok {
		// splitting was successful, so the entity is a tool name
		// only this tool needs to be enabled/disabled
		s, err := m.GetMcpServer(serverName)
		if err != nil {
			return nil, fmt.Errorf("failed to get MCP server %s: %w", serverName, err)
		}

		var tool model.Tool
		if err := m.db.Where("server_id = ? AND name = ?", s.ID, toolName).First(&tool).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("tool %s not found: %w", entity, apierrors.ErrNotFound)
			}
			return nil, fmt.Errorf("failed to get tool %s: %w", entity, err)
		}

		if tool.Enabled == enabled {
			return []string{entity}, nil // no change needed
		}

		tool.Enabled = enabled
		if err := m.db.Save(&tool).Error; err != nil {
			return nil, fmt.Errorf("failed to set tool %s enabled=%t: %w", entity, enabled, err)
		}
		if err := m.setToolPublished(s, &tool, s.Enabled && enabled); err != nil {
			return nil, err
		}

		return []string{entity}, nil
	}

	// splitting was unsuccessful, so the entity is a server name
	// all tools of this server need to be enabled/disabled.
	// The rows change even while the server is paused; they are published only when it is enabled.
	s, err := m.GetMcpServer(entity)
	if err != nil {
		return nil, fmt.Errorf("failed to get MCP server %s: %w", serverName, err)
	}

	var tools []model.Tool
	if err := m.db.Where("server_id = ?", s.ID).Find(&tools).Error; err != nil {
		return nil, fmt.Errorf("failed to get tools for server %s: %w", entity, err)
	}

	var changedToolNames []string
	for i := range tools {
		if tools[i].Enabled == enabled {
			continue // no change needed
		}
		tools[i].Enabled = enabled
		if err := m.db.Save(&tools[i]).Error; err != nil {
			return nil, fmt.Errorf("failed to set tool %s enabled=%t: %w", tools[i].Name, enabled, err)
		}
		if err := m.setToolPublished(s, &tools[i], s.Enabled && enabled); err != nil {
			return nil, err
		}
		changedToolNames = append(changedToolNames, mergeServerToolNames(s.Name, tools[i].Name))
	}

	return changedToolNames, nil
}

// registerServerTools fetches all tools from an MCP server and registers them in the DB.
func (m *MCPService) registerServerTools(ctx context.Context, s *model.McpServer, c *client.Client) error {
	// fetch all tools from the server so they can be added to the DB
	resp, err := c.ListTools(ctx, mcp.ListToolsRequest{})
	if err != nil {
		return fmt.Errorf("failed to fetch tools from MCP server %s: %w", s.Name, err)
	}
	for _, tool := range resp.Tools {
		canonicalToolName := mergeServerToolNames(s.Name, tool.GetName())

		// extracting json schema is currently on best-effort basis
		// if it fails, we log the error and continue with the next tool
		jsonSchema, _ := json.Marshal(tool.InputSchema)

		// extracting annotations is also on best-effort basis
		annotationsJSON, _ := json.Marshal(tool.Annotations)

		t := &model.Tool{
			ServerID:    s.ID,
			Name:        tool.GetName(),
			Description: tool.Description,
			InputSchema: jsonSchema,
			Annotations: annotationsJSON,
		}
		if err := m.db.Create(t).Error; err != nil {
			// If registration of a tool fails, we should not fail the entire server registration.
			// Instead, continue with the next tool.
			log.Printf("[ERROR] failed to register tool %s in DB: %v", canonicalToolName, err)
			continue
		}

		// Set tool name to include the server name prefix to make it recognizable by MCPJungle
		tool.Name = canonicalToolName
		m.publishTool(s, tool)
	}
	return nil
}

// deregisterServerTools deletes all tools that belong to an MCP server from the DB.
// It also removes the tools from the MCP proxy server.
func (m *MCPService) deregisterServerTools(s *model.McpServer) error {
	// load all tools for the server from the DB so we can delete them from the MCP proxy
	tools, err := m.ListToolsByServer(s.Name)
	if err != nil {
		return fmt.Errorf("failed to list tools for server %s: %w", s.Name, err)
	}

	// now it's safe to delete the server's tools from the DB
	result := m.db.Unscoped().Where("server_id = ?", s.ID).Delete(&model.Tool{})
	if result.Error != nil {
		return fmt.Errorf("failed to delete tools for server %s: %w", s.Name, result.Error)
	}

	toolNames := make([]string, len(tools))
	for i, tool := range tools {
		toolNames[i] = tool.Name
	}
	m.unpublishTools(s, toolNames...)

	return nil
}

// setToolPublished publishes or unpublishes one tool row of the server.
// Callers pass published = server.Enabled && tool.Enabled.
func (m *MCPService) setToolPublished(s *model.McpServer, t *model.Tool, published bool) error {
	name := mergeServerToolNames(s.Name, t.Name)
	if !published {
		m.unpublishTools(s, name)
		return nil
	}
	tool, err := convertToolModelToMcpObject(t)
	if err != nil {
		return fmt.Errorf("failed to convert tool model to MCP object for tool %s: %w", name, err)
	}
	tool.Name = name
	m.publishTool(s, tool)
	return nil
}

// publishTool exposes a tool, named canonically, on the gateway proxy and in every tool group that includes it.
func (m *MCPService) publishTool(s *model.McpServer, tool mcp.Tool) {
	m.proxyFor(s).AddTool(tool, m.MCPProxyToolCallHandler)
	m.addToolInstance(tool)
	m.notifyToolAddition(tool.Name)
}

// unpublishTools removes tools, named canonically, from the gateway proxy and from every tool group.
func (m *MCPService) unpublishTools(s *model.McpServer, names ...string) {
	m.proxyFor(s).DeleteTools(names...)
	m.deleteToolInstances(names...)
	m.notifyToolDeletion(names...)
}

// addToolInstance adds a tool instance to the in-memory tool instance tracker.
// This method does not check for duplicates.
// If a tool with the same name already exists, it is overwritten.
func (m *MCPService) addToolInstance(tool mcp.Tool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.toolInstances[tool.GetName()] = tool
}

// deleteToolInstances deletes one or more tool instances from the in-memory tool instance tracker.
func (m *MCPService) deleteToolInstances(toolNames ...string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, name := range toolNames {
		delete(m.toolInstances, name)
	}
}

// notifyToolDeletion calls all registered tool deletion callbacks with the given tool names.
func (m *MCPService) notifyToolDeletion(toolNames ...string) {
	m.toolDeletionCallback(toolNames...)
}

// notifyToolAddition calls all registered tool addition callbacks with the given tool names.
// This method works on best-effort basis. If a callback fails, it logs the error but does not propagate it.
func (m *MCPService) notifyToolAddition(toolName string) {
	if err := m.toolAdditionCallback(toolName); err != nil {
		// log the issue, but do not fail the entire operation
		// as the tool has already been added successfully
		log.Printf("[ERROR] tool addition callback failed for tool %s: %v", toolName, err)
	}
}

// convertToolCallResToAPIRes converts an MCP CallToolResult to types.ToolInvokeResult.
// This function handles the conversion from the SDK types to the internal types
// used by MCPJungle, with proper error handling and validation.
func (m *MCPService) convertToolCallResToAPIRes(resp *mcp.CallToolResult) (*types.ToolInvokeResult, error) {
	// Convert content
	contentList, err := m.convertToolCallRespContent(resp.Content)
	if err != nil {
		return nil, fmt.Errorf("failed to convert content: %w", err)
	}

	// Convert meta
	metaMap := m.convertMCPMetaToMap(resp.Meta)

	return &types.ToolInvokeResult{
		Meta:              metaMap,
		IsError:           resp.IsError,
		Content:           contentList,
		StructuredContent: resp.StructuredContent,
	}, nil
}

// convertToolCallRespContent converts []mcp.Content to []map[string]any with proper error handling.
func (m *MCPService) convertToolCallRespContent(content []mcp.Content) ([]map[string]any, error) {
	if len(content) == 0 {
		return []map[string]any{}, nil
	}

	contentList := make([]map[string]any, 0, len(content))

	for i, item := range content {
		// Use a single marshal/unmarshal with proper error handling
		serialized, err := json.Marshal(item)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal content item %d: %w", i, err)
		}

		var contentMap map[string]any
		if err := json.Unmarshal(serialized, &contentMap); err != nil {
			return nil, fmt.Errorf("failed to unmarshal content item %d: %w", i, err)
		}

		contentList = append(contentList, contentMap)
	}

	return contentList, nil
}

// convertMCPMetaToMap converts *mcp.Meta to map[string]any with proper nil handling.
func (m *MCPService) convertMCPMetaToMap(meta *mcp.Meta) map[string]any {
	if meta == nil {
		return nil
	}

	// Start with additional fields if they exist
	metaMap := make(map[string]any)
	if meta.AdditionalFields != nil {
		// Copy all additional fields
		for k, v := range meta.AdditionalFields {
			metaMap[k] = v
		}
	}

	// Add progress token if present
	if meta.ProgressToken != nil {
		metaMap["progressToken"] = meta.ProgressToken
	}

	// Return nil if map is empty to maintain consistency
	if len(metaMap) == 0 {
		return nil
	}

	return metaMap
}
