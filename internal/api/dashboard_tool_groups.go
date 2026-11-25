package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mcpjungle/mcpjungle/internal/model"
	"github.com/mcpjungle/mcpjungle/pkg/types"
)

// dashboardToolGroupRequest is a tool set as the dashboard edits it: whole
// servers, single tools, and tools excluded from those servers. Name is read
// on create only; an update takes the name from the path.
type dashboardToolGroupRequest struct {
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Tools         []string `json:"tools"`
	Servers       []string `json:"servers"`
	ExcludedTools []string `json:"excluded_tools"`
}

func (r dashboardToolGroupRequest) toModel(name string) *model.ToolGroup {
	return &model.ToolGroup{
		Name:            name,
		Description:     r.Description,
		IncludedTools:   jsonList(r.Tools),
		IncludedServers: jsonList(r.Servers),
		ExcludedTools:   jsonList(r.ExcludedTools),
	}
}

// jsonList encodes an empty list as [], never null, so a list the operator
// cleared is stored as an empty list.
func jsonList(values []string) []byte {
	if values == nil {
		values = []string{}
	}
	encoded, _ := json.Marshal(values) // a []string always encodes
	return encoded
}

type dashboardToolGroupTool struct {
	Name          string `json:"name"`
	CanonicalName string `json:"canonical_name"`
	Server        string `json:"server"`
	Description   string `json:"description,omitempty"`
}

type dashboardToolGroup struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// IncludedTools, IncludedServers and ExcludedTools are the selection as
	// stored; Tools is what it resolves to now.
	IncludedTools          []string                 `json:"included_tools"`
	IncludedServers        []string                 `json:"included_servers"`
	ExcludedTools          []string                 `json:"excluded_tools"`
	ToolCount              int                      `json:"tool_count"`
	Tools                  []dashboardToolGroupTool `json:"tools"`
	StreamableHTTPEndpoint string                   `json:"streamable_http_endpoint"`
	SSEEndpoint            string                   `json:"sse_endpoint"`
	SSEMessageEndpoint     string                   `json:"sse_message_endpoint"`
}

type dashboardToolGroupsResponse struct {
	ToolGroups []dashboardToolGroup       `json:"tool_groups"`
	EmptyState *types.DashboardEmptyState `json:"empty_state,omitempty"`
}

func (s *Server) dashboardToolGroupsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		groups, err := s.toolGroupService.ListToolGroups()
		if err != nil {
			handleServiceError(c, err)
			return
		}

		resp := dashboardToolGroupsResponse{
			ToolGroups: make([]dashboardToolGroup, 0, len(groups)),
		}
		for _, group := range groups {
			item, err := s.buildDashboardToolGroup(c, group)
			if err != nil {
				handleServiceError(c, err)
				return
			}
			resp.ToolGroups = append(resp.ToolGroups, item)
		}

		if len(resp.ToolGroups) == 0 {
			resp.EmptyState = &types.DashboardEmptyState{
				Title:       "No tool groups configured yet.",
				Description: "Create a tool group to expose a focused subset of MCP tools.",
				Commands: []string{
					"mcpjungle create group --conf group.json",
					"mcpjungle list groups",
					"mcpjungle get group <group-name>",
				},
			}
		}

		c.JSON(http.StatusOK, resp)
	}
}

func (s *Server) dashboardGetToolGroupHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		group, err := s.toolGroupService.GetToolGroup(c.Param("name"))
		if err != nil {
			handleServiceError(c, err)
			return
		}

		resp, err := s.buildDashboardToolGroup(c, *group)
		if err != nil {
			handleServiceError(c, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

func (s *Server) dashboardCreateToolGroupHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var input dashboardToolGroupRequest
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		group := input.toModel(input.Name)
		if err := s.toolGroupService.CreateToolGroup(group); err != nil {
			handleServiceError(c, err)
			return
		}

		resp, err := s.buildDashboardToolGroup(c, *group)
		if err != nil {
			handleServiceError(c, err)
			return
		}
		c.JSON(http.StatusCreated, resp)
	}
}

func (s *Server) dashboardUpdateToolGroupHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var input dashboardToolGroupRequest
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		name := c.Param("name")
		if _, err := s.toolGroupService.UpdateToolGroup(name, input.toModel(name)); err != nil {
			handleServiceError(c, err)
			return
		}

		updated, err := s.toolGroupService.GetToolGroup(name)
		if err != nil {
			handleServiceError(c, err)
			return
		}
		resp, err := s.buildDashboardToolGroup(c, *updated)
		if err != nil {
			handleServiceError(c, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

func (s *Server) dashboardDeleteToolGroupHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := s.toolGroupService.DeleteToolGroup(c.Param("name")); err != nil {
			handleServiceError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": true})
	}
}

func (s *Server) buildDashboardToolGroup(c *gin.Context, group model.ToolGroup) (dashboardToolGroup, error) {
	includedTools, err := group.GetTools()
	if err != nil {
		return dashboardToolGroup{}, err
	}
	includedServers, err := group.GetServers()
	if err != nil {
		return dashboardToolGroup{}, err
	}
	excludedTools, err := group.GetExcludedTools()
	if err != nil {
		return dashboardToolGroup{}, err
	}
	toolNames, err := group.ResolveEffectiveTools(s.mcpService)
	if err != nil {
		return dashboardToolGroup{}, err
	}
	sort.Strings(toolNames)

	tools := make([]dashboardToolGroupTool, 0, len(toolNames))
	for _, toolName := range toolNames {
		item := dashboardToolGroupTool{
			CanonicalName: toolName,
			Name:          toolName,
			Server:        "Unknown",
		}
		if tool, err := s.mcpService.GetTool(toolName); err == nil {
			item.Name = tool.Name
			if server, serverErr := s.mcpService.GetToolParentServer(toolName); serverErr == nil {
				item.Server = server.Name
			}
			item.CanonicalName = toolName
			item.Description = tool.Description
		}
		respName := item.Name
		parts := strings.SplitN(toolName, "__", 2)
		if len(parts) == 2 {
			respName = parts[1]
		}
		item.Name = respName
		tools = append(tools, item)
	}

	endpoints := getToolGroupEndpoints(c, group.Name)

	return dashboardToolGroup{
		Name:                   group.Name,
		Description:            group.Description,
		IncludedTools:          orEmpty(includedTools),
		IncludedServers:        orEmpty(includedServers),
		ExcludedTools:          orEmpty(excludedTools),
		ToolCount:              len(tools),
		Tools:                  tools,
		StreamableHTTPEndpoint: endpoints.StreamableHTTPEndpoint,
		SSEEndpoint:            endpoints.SSEEndpoint,
		SSEMessageEndpoint:     endpoints.SSEMessageEndpoint,
	}, nil
}

// orEmpty keeps a stored "null" list from reaching the dashboard as null.
func orEmpty(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
