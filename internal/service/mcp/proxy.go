package mcp

import (
	"context"
	"fmt"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mcpjungle/mcpjungle/internal/model"
	"github.com/mcpjungle/mcpjungle/internal/telemetry"
	"github.com/mcpjungle/mcpjungle/pkg/apierrors"
)

func authorizeProxyServerAccess(ctx context.Context, serverName string) error {
	serverMode := ctx.Value("mode").(model.ServerMode)
	if !model.IsEnterpriseMode(serverMode) {
		return nil
	}

	c := ctx.Value("client").(*model.McpClient)
	if !c.CheckHasServerAccess(serverName) {
		return fmt.Errorf("client %s is not authorized to access MCP server %s", c.Name, serverName)
	}

	return nil
}

// MCPProxyToolCallHandler handles tool calls for the MCP proxy server
// by forwarding the request to the appropriate upstream MCP server and
// relaying the response back.
func (m *MCPService) MCPProxyToolCallHandler(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	started := time.Now()
	outcome := telemetry.ToolCallOutcomeSuccess

	name := request.Params.Name
	serverName, toolName, ok := splitServerToolName(name)
	if !ok {
		return nil, fmt.Errorf("tool name does not contain a %s separator: %w", serverToolNameSep, apierrors.ErrInvalidInput)
	}

	if err := authorizeProxyServerAccess(ctx, serverName); err != nil {
		return nil, err
	}

	// Record the tool call metrics at the end of the function
	defer func() {
		m.metrics.RecordToolCall(ctx, serverName, toolName, outcome, time.Since(started))
	}()

	// get the MCP server details from the database
	server, err := m.GetMcpServer(serverName)
	if err != nil {
		// TODO: differentiate between "server not found" and other errors.
		// server not found is not an internal error, so outcome should be success.
		outcome = telemetry.ToolCallOutcomeError

		return nil, fmt.Errorf(
			"failed to get details about MCP server %s from DB: %w", serverName, err,
		)
	}

	// Ensure the tool name is set correctly, ie, without the server name prefix
	request.Params.Name = toolName
	// Do not let any client-sent headers get forwarded to the upstream MCP server.
	// See https://github.com/mcpjungle/MCPJungle/issues/252
	request.Header = nil

	// forward the request to the upstream MCP server and relay the response back
	res, err := m.callTool(ctx, server, request)
	if err != nil {
		outcome = telemetry.ToolCallOutcomeError
		return nil, err
	}
	m.signIns.observe(server, res, time.Now())
	return res, nil
}

// mcpProxyResourceHandler handles resource reads for the MCP proxy server
// by forwarding the request to the appropriate upstream MCP server and
// relaying the response back.
func (m *MCPService) mcpProxyResourceHandler(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
	// get the upstream mcp server and original resource uri for the requested resource uri
	resource, err := m.GetResource(request.Params.URI)
	if err != nil {
		return nil, fmt.Errorf("failed to get resource %s from DB: %w", request.Params.URI, err)
	}

	if err := authorizeProxyServerAccess(ctx, resource.Server.Name); err != nil {
		return nil, err
	}

	session, err := m.getSession(ctx, &resource.Server)
	if err != nil {
		return nil, err
	}
	defer session.closeIfApplicable()

	request.Params.URI = resource.OriginalURI

	// Do not let any client-sent headers get forwarded to the upstream MCP server.
	request.Header = nil

	res, err := session.client.ReadResource(ctx, request)
	if err != nil {
		session.invalidateOnError(err)
		return nil, err
	}

	return rewriteResourceContentsURI(res.Contents, resource.URI), nil
}

// mcpProxyPromptHandler handles prompt requests for the MCP proxy server
// by forwarding the request to the appropriate upstream MCP server and
// relaying the response back.
func (m *MCPService) mcpProxyPromptHandler(ctx context.Context, request mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
	started := time.Now()
	outcome := telemetry.PromptCallOutcomeSuccess

	name := request.Params.Name
	serverName, promptName, ok := splitServerPromptName(name)
	if !ok {
		return nil, fmt.Errorf("prompt name does not contain a %s separator: %w", serverPromptNameSep, apierrors.ErrInvalidInput)
	}

	if err := authorizeProxyServerAccess(ctx, serverName); err != nil {
		return nil, err
	}

	// Record the prompt call metrics at the end of the function
	defer func() {
		m.metrics.RecordPromptCall(ctx, serverName, promptName, outcome, time.Since(started))
	}()

	// get the MCP server details from the database
	server, err := m.GetMcpServer(serverName)
	if err != nil {
		// TODO: differentiate between "server not found" and other errors.
		// server not found is not an internal error, so outcome should be success.
		outcome = telemetry.PromptCallOutcomeError

		return nil, fmt.Errorf(
			"failed to get details about MCP server %s from DB: %w", serverName, err,
		)
	}

	session, err := m.getSession(ctx, server)
	if err != nil {
		outcome = telemetry.PromptCallOutcomeError
		return nil, err
	}
	defer session.closeIfApplicable()

	// Ensure the prompt name is set correctly, ie, without the server name prefix
	request.Params.Name = promptName
	// Do not let any client-sent headers get forwarded to the upstream MCP server.
	request.Header = nil

	// forward the request to the upstream MCP server and relay the response back
	res, err := session.client.GetPrompt(ctx, request)
	if err != nil {
		outcome = telemetry.PromptCallOutcomeError
		session.invalidateOnError(err) // Invalidate unhealthy stateful sessions
	}

	return res, err
}

// initMCPProxyServer publishes the items of every registered server at startup.
// Items of a paused server stay unpublished.
func (m *MCPService) initMCPProxyServer() error {
	servers, err := m.ListMcpServers()
	if err != nil {
		return fmt.Errorf("failed to list MCP servers from DB: %w", err)
	}
	for i := range servers {
		if _, _, err := m.syncServerPublication(&servers[i]); err != nil {
			return fmt.Errorf("init mcp proxy server: %w", err)
		}
	}
	return nil
}
