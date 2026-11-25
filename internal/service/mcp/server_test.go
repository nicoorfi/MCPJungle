package mcp

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	mcpclient "github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/mcpjungle/mcpjungle/internal/model"
	"github.com/mcpjungle/mcpjungle/internal/telemetry"
	"github.com/mcpjungle/mcpjungle/pkg/apierrors"
	"github.com/mcpjungle/mcpjungle/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDBForServerLifecycle(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	err = db.AutoMigrate(
		&model.McpServer{},
		&model.Tool{},
		&model.Prompt{},
		&model.Resource{},
		&model.UpstreamOAuthToken{},
		&model.UpstreamOAuthPendingSession{},
	)
	require.NoError(t, err)

	return db
}

func newTestLifecycleService(t *testing.T, db *gorm.DB) *MCPService {
	t.Helper()

	service, err := NewMCPService(&ServiceConfig{
		DB: db,
		McpProxyServer: mcpserver.NewMCPServer(
			"Test Proxy",
			"0.1.0",
			mcpserver.WithToolCapabilities(true),
			mcpserver.WithPromptCapabilities(true),
			mcpserver.WithResourceCapabilities(true, true),
		),
		SseMcpProxyServer: mcpserver.NewMCPServer(
			"Test Proxy SSE",
			"0.1.0",
			mcpserver.WithToolCapabilities(true),
			mcpserver.WithPromptCapabilities(true),
			mcpserver.WithResourceCapabilities(true, true),
		),
		Metrics:                 telemetry.NewNoopCustomMetrics(),
		McpServerInitReqTimeout: 5,
	})
	require.NoError(t, err)
	t.Cleanup(service.Shutdown)
	return service
}

func newInitializedInProcessClient(t *testing.T, srv *mcpserver.MCPServer) *mcpclient.Client {
	t.Helper()

	client, err := mcpclient.NewInProcessClient(srv)
	require.NoError(t, err)

	ctx := context.Background()
	require.NoError(t, client.Start(ctx))

	initReq := mcp.InitializeRequest{}
	initReq.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
	initReq.Params.ClientInfo = mcp.Implementation{Name: "test-client", Version: "1.0.0"}
	_, err = client.Initialize(ctx, initReq)
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = client.Close()
	})

	return client
}

func createTestToolRecord(t *testing.T, db *gorm.DB, server *model.McpServer, name string, enabled bool) *model.Tool {
	t.Helper()

	schema, err := json.Marshal(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"msg": map[string]any{"type": "string"},
		},
	})
	require.NoError(t, err)

	tool := &model.Tool{
		ServerID:    server.ID,
		Name:        name,
		Description: "Test tool",
		InputSchema: schema,
		Enabled:     enabled,
	}
	require.NoError(t, db.Create(tool).Error)
	if !enabled {
		require.NoError(t, db.Model(tool).Update("enabled", false).Error)
		tool.Enabled = false
	}
	return tool
}

func createTestPromptRecord(t *testing.T, db *gorm.DB, server *model.McpServer, name string, enabled bool) *model.Prompt {
	t.Helper()

	args, err := json.Marshal([]mcp.PromptArgument{
		{
			Name:        "topic",
			Description: "Prompt topic",
			Required:    true,
		},
	})
	require.NoError(t, err)

	prompt := &model.Prompt{
		ServerID:    server.ID,
		Name:        name,
		Description: "Test prompt",
		Arguments:   args,
		Enabled:     enabled,
	}
	require.NoError(t, db.Create(prompt).Error)
	if !enabled {
		require.NoError(t, db.Model(prompt).Update("enabled", false).Error)
		prompt.Enabled = false
	}
	return prompt
}

func createTestResourceRecord(t *testing.T, db *gorm.DB, server *model.McpServer, originalURI, name string, enabled bool) *model.Resource {
	t.Helper()

	resource := &model.Resource{
		URI:         buildResourceURI(server.Name, originalURI),
		OriginalURI: originalURI,
		Name:        name,
		Description: "Test resource",
		MIMEType:    "text/plain",
		Enabled:     enabled,
		ServerID:    server.ID,
	}
	require.NoError(t, db.Create(resource).Error)
	if !enabled {
		require.NoError(t, db.Model(resource).Update("enabled", false).Error)
		resource.Enabled = false
	}
	return resource
}

func TestRegisterMcpServerWithOAuthSupport_StreamableHTTPRegistersServerAndEntities(t *testing.T) {
	db := setupTestDBForServerLifecycle(t)
	service := newTestLifecycleService(t, db)

	upstream := mcpserver.NewMCPServer(
		"Upstream",
		"0.1.0",
		mcpserver.WithToolCapabilities(true),
		mcpserver.WithPromptCapabilities(true),
		mcpserver.WithResourceCapabilities(true, true),
	)
	upstream.AddTool(
		mcp.NewTool("echo", mcp.WithString("msg")),
		func(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			msg, _ := request.GetArguments()["msg"].(string)
			return mcp.NewToolResultText(msg), nil
		},
	)
	upstream.AddPrompt(
		mcp.NewPrompt(
			"review",
			mcp.WithArgument("topic", mcp.ArgumentDescription("Topic to review"), mcp.RequiredArgument()),
		),
		func(ctx context.Context, request mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			return &mcp.GetPromptResult{
				Description: "Review prompt",
				Messages: []mcp.PromptMessage{
					mcp.NewPromptMessage(mcp.RoleAssistant, mcp.TextContent{Type: "text", Text: "ok"}),
				},
			}, nil
		},
	)
	upstream.AddResource(
		mcp.NewResource("resource://catalog/spec", "spec", mcp.WithResourceDescription("Spec"), mcp.WithMIMEType("text/plain")),
		func(ctx context.Context, request mcp.ReadResourceRequest) ([]mcp.ResourceContents, error) {
			return []mcp.ResourceContents{
				mcp.TextResourceContents{URI: request.Params.URI, MIMEType: "text/plain", Text: "spec body"},
			}, nil
		},
	)

	httpServer := newUpstreamStreamableHTTPServer(t, upstream)
	defer httpServer.Close()

	srv, err := model.NewStreamableHTTPServer(
		"catalog",
		"Catalog server",
		httpServer.URL,
		"",
		nil,
		types.SessionModeStateless,
	)
	require.NoError(t, err)

	err = service.RegisterMcpServerWithOAuthSupport(context.Background(), &types.RegisterServerInput{}, srv, false, "test")
	require.NoError(t, err)

	var serverCount, toolCount, promptCount, resourceCount int64
	require.NoError(t, db.Model(&model.McpServer{}).Count(&serverCount).Error)
	require.NoError(t, db.Model(&model.Tool{}).Count(&toolCount).Error)
	require.NoError(t, db.Model(&model.Prompt{}).Count(&promptCount).Error)
	require.NoError(t, db.Model(&model.Resource{}).Count(&resourceCount).Error)
	assert.EqualValues(t, 1, serverCount)
	assert.EqualValues(t, 1, toolCount)
	assert.EqualValues(t, 1, promptCount)
	assert.EqualValues(t, 1, resourceCount)

	registeredServer, err := service.GetMcpServer("catalog")
	require.NoError(t, err)
	assert.True(t, registeredServer.Enabled)

	tool, err := service.GetTool("catalog__echo")
	require.NoError(t, err)
	assert.Equal(t, "catalog__echo", tool.Name)

	prompts, err := service.ListPromptsByServer("catalog")
	require.NoError(t, err)
	require.Len(t, prompts, 1)
	assert.Equal(t, "catalog__review", prompts[0].Name)

	resources, err := service.ListResourcesByServer("catalog")
	require.NoError(t, err)
	require.Len(t, resources, 1)
	assert.Equal(t, "catalog__spec", resources[0].Name)

	_, ok := service.GetToolInstance("catalog__echo")
	assert.True(t, ok)

	proxyClient := newInitializedInProcessClient(t, service.mcpProxyServer)
	toolList, err := proxyClient.ListTools(context.Background(), mcp.ListToolsRequest{})
	require.NoError(t, err)
	require.Len(t, toolList.Tools, 1)
	assert.Equal(t, "catalog__echo", toolList.Tools[0].Name)

	promptList, err := proxyClient.ListPrompts(context.Background(), mcp.ListPromptsRequest{})
	require.NoError(t, err)
	require.Len(t, promptList.Prompts, 1)
	assert.Equal(t, "catalog__review", promptList.Prompts[0].Name)

	resourceList, err := proxyClient.ListResources(context.Background(), mcp.ListResourcesRequest{})
	require.NoError(t, err)
	require.Len(t, resourceList.Resources, 1)
	assert.Equal(t, buildResourceURI("catalog", "resource://catalog/spec"), resourceList.Resources[0].URI)
}

func TestRegisterMcpServer_RejectsInvalidNameAndURLBeforePersistence(t *testing.T) {
	tests := []struct {
		name        string
		server      func(t *testing.T) *model.McpServer
		expectError string
	}{
		{
			name: "invalid server name",
			server: func(t *testing.T) *model.McpServer {
				srv, err := model.NewStdioServer("valid-name", "Test", "echo", []string{"hello"}, nil, types.SessionModeStateless)
				require.NoError(t, err)
				srv.Name = "bad__name"
				return srv
			},
			expectError: "invalid server name",
		},
		{
			name: "invalid streamable http url",
			server: func(t *testing.T) *model.McpServer {
				srv, err := model.NewStreamableHTTPServer("http-server", "Test", "not-a-url", "", nil, types.SessionModeStateless)
				require.NoError(t, err)
				return srv
			},
			expectError: "invalid url",
		},
		{
			name: "invalid sse url",
			server: func(t *testing.T) *model.McpServer {
				srv, err := model.NewSSEServer("sse-server", "Test", "still-not-a-url", "", types.SessionModeStateless)
				require.NoError(t, err)
				return srv
			},
			expectError: "invalid url",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := setupTestDBForServerLifecycle(t)
			service := newTestLifecycleService(t, db)

			err := service.registerMcpServer(context.Background(), tt.server(t), false)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.expectError)

			var serverCount int64
			require.NoError(t, db.Model(&model.McpServer{}).Count(&serverCount).Error)
			assert.Zero(t, serverCount)
		})
	}
}

// Pausing a server must not overwrite the choices made on its items.
// Rule: an item is published iff server.Enabled && item.Enabled.
func TestPauseResumeMcpServer_KeepsItemChoices(t *testing.T) {
	db := setupTestDBForServerLifecycle(t)
	srv := createTestServer(t, db)
	createTestToolRecord(t, db, srv, "echo", true)
	createTestToolRecord(t, db, srv, "delete", false)
	createTestPromptRecord(t, db, srv, "review", true)
	createTestPromptRecord(t, db, srv, "draft", false)
	status := createTestResourceRecord(t, db, srv, "resource://test/status", "status", true)
	secret := createTestResourceRecord(t, db, srv, "resource://test/secret", "secret", false)

	service := newTestLifecycleService(t, db)

	published := func() (tools, prompts, resources []string) {
		for name := range service.mcpProxyServer.ListTools() {
			tools = append(tools, name)
		}
		for name := range service.mcpProxyServer.ListPrompts() {
			prompts = append(prompts, name)
		}
		for uri := range service.mcpProxyServer.ListResources() {
			resources = append(resources, uri)
		}
		return tools, prompts, resources
	}
	assertItemRowsUnchanged := func() {
		t.Helper()
		var tools []model.Tool
		require.NoError(t, db.Order("name").Find(&tools).Error)
		require.Len(t, tools, 2)
		assert.Equal(t, "delete", tools[0].Name)
		assert.False(t, tools[0].Enabled)
		assert.True(t, tools[1].Enabled)

		var prompts []model.Prompt
		require.NoError(t, db.Order("name").Find(&prompts).Error)
		require.Len(t, prompts, 2)
		assert.Equal(t, "draft", prompts[0].Name)
		assert.False(t, prompts[0].Enabled)
		assert.True(t, prompts[1].Enabled)

		var resources []model.Resource
		require.NoError(t, db.Order("name").Find(&resources).Error)
		require.Len(t, resources, 2)
		assert.Equal(t, "secret", resources[0].Name)
		assert.False(t, resources[0].Enabled)
		assert.True(t, resources[1].Enabled)
	}

	tools, prompts, resources := published()
	assert.Equal(t, []string{"test-server__echo"}, tools)
	assert.Equal(t, []string{"test-server__review"}, prompts)
	assert.Equal(t, []string{status.URI}, resources)

	// pause
	pausedTools, pausedPrompts, err := service.DisableMcpServer("test-server")
	require.NoError(t, err)
	assert.Equal(t, []string{"test-server__echo"}, pausedTools)
	assert.Equal(t, []string{"test-server__review"}, pausedPrompts)

	updatedServer, err := service.GetMcpServer("test-server")
	require.NoError(t, err)
	assert.False(t, updatedServer.Enabled)
	assertItemRowsUnchanged()

	tools, prompts, resources = published()
	assert.Empty(t, tools)
	assert.Empty(t, prompts)
	assert.Empty(t, resources)
	_, ok := service.GetToolInstance("test-server__echo")
	assert.False(t, ok)

	// a paused server refuses direct invocation
	_, err = service.InvokeTool(context.Background(), "test-server__echo", map[string]any{})
	require.ErrorIs(t, err, apierrors.ErrInvalidInput)
	_, err = service.GetPromptWithArgs(context.Background(), "test-server__review", map[string]any{})
	require.ErrorIs(t, err, apierrors.ErrInvalidInput)
	_, err = service.ReadResource(context.Background(), status.URI)
	require.ErrorIs(t, err, apierrors.ErrInvalidInput)

	// enabling one tool while the server is paused writes its row but does not publish it
	_, err = service.EnableTools("test-server__delete")
	require.NoError(t, err)
	tools, _, _ = published()
	assert.Empty(t, tools)
	_, err = service.DisableTools("test-server__delete")
	require.NoError(t, err)

	// startup keeps a paused server's items unpublished
	restarted := newTestLifecycleService(t, db)
	assert.Empty(t, restarted.mcpProxyServer.ListTools())
	assert.Empty(t, restarted.mcpProxyServer.ListPrompts())
	assert.Empty(t, restarted.mcpProxyServer.ListResources())

	// resume through the dashboard path
	require.NoError(t, service.SetDashboardServerEnabled("test-server", true))

	updatedServer, err = service.GetMcpServer("test-server")
	require.NoError(t, err)
	assert.True(t, updatedServer.Enabled)
	assertItemRowsUnchanged()

	tools, prompts, resources = published()
	assert.Equal(t, []string{"test-server__echo"}, tools)
	assert.Equal(t, []string{"test-server__review"}, prompts)
	assert.Equal(t, []string{status.URI}, resources)
	assert.NotContains(t, resources, secret.URI)
	_, ok = service.GetToolInstance("test-server__echo")
	assert.True(t, ok)
	_, ok = service.GetToolInstance("test-server__delete")
	assert.False(t, ok)

	// an item disabled on its own refuses direct invocation on an enabled server
	_, err = service.InvokeTool(context.Background(), "test-server__delete", map[string]any{})
	require.ErrorIs(t, err, apierrors.ErrInvalidInput)
	_, err = service.GetPromptWithArgs(context.Background(), "test-server__draft", map[string]any{})
	require.ErrorIs(t, err, apierrors.ErrInvalidInput)
	_, err = service.ReadResource(context.Background(), secret.URI)
	require.ErrorIs(t, err, apierrors.ErrInvalidInput)

	// resuming an enabled server changes nothing
	resumedTools, resumedPrompts, err := service.EnableMcpServer("test-server")
	require.NoError(t, err)
	assert.Empty(t, resumedTools)
	assert.Empty(t, resumedPrompts)
}

func TestDeregisterMcpServer_RemovesEntitiesOAuthStateAndSession(t *testing.T) {
	db := setupTestDBForServerLifecycle(t)
	srv := createTestServer(t, db)
	createTestToolRecord(t, db, srv, "echo", true)
	createTestPromptRecord(t, db, srv, "review", true)
	createTestResourceRecord(t, db, srv, "resource://test/status", "status", true)

	require.NoError(t, db.Create(&model.UpstreamOAuthToken{
		ServerName:   srv.Name,
		Transport:    srv.Transport,
		AccessToken:  "token",
		RefreshToken: "refresh",
		ClientID:     "client-id",
		ClientSecret: "secret",
		RedirectURI:  "http://localhost/callback",
		TokenType:    "Bearer",
	}).Error)
	require.NoError(t, db.Create(&model.UpstreamOAuthPendingSession{
		SessionID:    "pending-session",
		ServerName:   srv.Name,
		Transport:    srv.Transport,
		ServerInput:  []byte(`{}`),
		Force:        false,
		State:        "state-value",
		CodeVerifier: "code-verifier",
		ExpiresAt:    time.Now().Add(time.Hour),
	}).Error)

	service := newTestLifecycleService(t, db)
	service.sessionManager.sessions[srv.Name] = &ManagedSession{ServerName: srv.Name}
	require.True(t, service.sessionManager.HasSession(srv.Name))

	err := service.DeregisterMcpServer(srv.Name)
	require.NoError(t, err)

	var serverCount, toolCount, promptCount, resourceCount, tokenCount, pendingCount int64
	require.NoError(t, db.Unscoped().Model(&model.McpServer{}).Count(&serverCount).Error)
	require.NoError(t, db.Unscoped().Model(&model.Tool{}).Count(&toolCount).Error)
	require.NoError(t, db.Unscoped().Model(&model.Prompt{}).Count(&promptCount).Error)
	require.NoError(t, db.Unscoped().Model(&model.Resource{}).Count(&resourceCount).Error)
	require.NoError(t, db.Unscoped().Model(&model.UpstreamOAuthToken{}).Count(&tokenCount).Error)
	require.NoError(t, db.Unscoped().Model(&model.UpstreamOAuthPendingSession{}).Count(&pendingCount).Error)
	assert.Zero(t, serverCount)
	assert.Zero(t, toolCount)
	assert.Zero(t, promptCount)
	assert.Zero(t, resourceCount)
	assert.Zero(t, tokenCount)
	assert.Zero(t, pendingCount)

	assert.Nil(t, service.mcpProxyServer.GetTool("test-server__echo"))
	_, ok := service.GetToolInstance("test-server__echo")
	assert.False(t, ok)
	assert.False(t, service.sessionManager.HasSession(srv.Name))
}
