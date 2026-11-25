package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mcpjungle/mcpjungle/internal/model"
	"github.com/mcpjungle/mcpjungle/pkg/apierrors"
	"github.com/mcpjungle/mcpjungle/pkg/testhelpers"
	"github.com/mcpjungle/mcpjungle/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// workspaceMCPLink is the shape of the consent link workspace-mcp 2.5.0 hands out.
const workspaceMCPLink = "https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=123.apps.googleusercontent.com" +
	"&redirect_uri=http%3A%2F%2Flocalhost%3A8010%2Foauth2callback&scope=openid&state=5f1d2c&access_type=offline&prompt=consent"

func TestParseSignInLink(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name      string
		text      string
		wantState string
		wantHost  string
	}{
		{
			name:      "workspace-mcp message",
			text:      "**ACTION REQUIRED: Google Authentication Needed**\n\n1. Open this URL:\n   Authorization URL: " + workspaceMCPLink + "\n2. Retry.",
			wantState: "5f1d2c",
			wantHost:  "localhost:8010",
		},
		{
			name:      "markdown link with trailing period",
			text:      "Sign in [here](" + workspaceMCPLink + "). Or open " + workspaceMCPLink + ".",
			wantState: "5f1d2c",
			wantHost:  "localhost:8010",
		},
		{
			name:      "127.0.0.1 redirect",
			text:      "Open https://auth.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A9000%2Fcb&state=s1",
			wantState: "s1",
			wantHost:  "127.0.0.1:9000",
		},
		{name: "tailnet https redirect is ignored", text: "Open https://auth.example.com/authorize?redirect_uri=https%3A%2F%2Fbeelink.tail1234.ts.net%2Fcb&state=s1"},
		{name: "https loopback redirect is ignored", text: "Open https://auth.example.com/authorize?redirect_uri=https%3A%2F%2Flocalhost%3A9000%2Fcb&state=s1"},
		{name: "other loopback address is ignored", text: "Open https://auth.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.2%3A9000%2Fcb&state=s1"},
		{name: "link without state is ignored", text: "Open https://auth.example.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A9000%2Fcb"},
		{name: "link without redirect is ignored", text: "Docs at https://example.com/guide?state=s1"},
		{name: "no link", text: "3 calendars found"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			link, ok := parseSignInLink(tt.text, now, func(*url.URL) bool { return true })
			if tt.wantState == "" {
				assert.False(t, ok)
				return
			}
			require.True(t, ok)
			assert.Equal(t, tt.wantState, link.state)
			assert.Equal(t, tt.wantHost, link.redirect.Host)
			assert.Equal(t, now, link.seenAt)
			_, err := url.Parse(link.authURL)
			require.NoError(t, err)
			assert.NotContains(t, link.authURL, ")")
			assert.NotRegexp(t, `\.$`, link.authURL)
		})
	}
}

func TestSignInCallbackTarget(t *testing.T) {
	now := time.Now()
	redirect, err := url.Parse("http://localhost:8010/oauth2callback")
	require.NoError(t, err)
	pending := map[string]pendingSignIn{
		"abc":   {redirect: redirect, state: "abc", seenAt: now.Add(-time.Minute)},
		"stale": {redirect: redirect, state: "stale", seenAt: now.Add(-signInLifetime)},
	}

	t.Run("callback of a pending sign-in", func(t *testing.T) {
		target, link, err := signInCallbackTarget("  http://localhost:8010/oauth2callback?state=abc&code=SECRET&scope=openid  ", pending, now)
		require.NoError(t, err)
		assert.Equal(t, "abc", link.state)
		assert.Equal(t, "http://127.0.0.1:8010/oauth2callback?state=abc&code=SECRET&scope=openid", target.String())
	})

	t.Run("pasted user info and fragment are dropped", func(t *testing.T) {
		target, _, err := signInCallbackTarget("http://user:pw@localhost:8010/oauth2callback?state=abc&code=SECRET#done", pending, now)
		require.NoError(t, err)
		assert.Equal(t, "http://127.0.0.1:8010/oauth2callback?state=abc&code=SECRET", target.String())
	})

	refusals := []struct {
		name   string
		landed string
		reason string
	}{
		{"not a URL", "the page said can't connect", "full address"},
		{"no state", "http://localhost:8010/oauth2callback?code=SECRET", "no state"},
		{"wrong state", "http://localhost:8010/oauth2callback?state=zzz&code=SECRET", "does not match"},
		{"expired sign-in", "http://localhost:8010/oauth2callback?state=stale&code=SECRET", "expired after 10 minutes"},
		{"wrong host", "http://evil.example:8010/oauth2callback?state=abc&code=SECRET", "must be on localhost"},
		{"other loopback name", "http://127.0.0.1:8010/oauth2callback?state=abc&code=SECRET", "must be on localhost"},
		{"wrong port", "http://localhost:6379/oauth2callback?state=abc&code=SECRET", "must use port 8010"},
		{"missing port", "http://localhost/oauth2callback?state=abc&code=SECRET", "must use port 8010"},
		{"wrong path", "http://localhost:8010/admin/shutdown?state=abc&code=SECRET", "must end at /oauth2callback"},
	}
	for _, tt := range refusals {
		t.Run(tt.name, func(t *testing.T) {
			target, _, err := signInCallbackTarget(tt.landed, pending, now)
			require.Error(t, err)
			assert.Nil(t, target)
			assert.ErrorIs(t, err, apierrors.ErrInvalidInput)
			assert.Contains(t, err.Error(), tt.reason)
			assert.NotContains(t, err.Error(), "SECRET")
		})
	}
}

func TestSignInTracker_StatusFollowsResults(t *testing.T) {
	var tracker signInTracker
	google := &model.McpServer{Name: "google", Transport: types.TransportStdio}
	now := time.Now()
	asks := mcp.NewToolResultError("Authorization URL: " + workspaceMCPLink)

	assert.True(t, tracker.observe(google, asks, now))
	assert.True(t, tracker.isRequired("google"))

	assert.False(t, tracker.observe(google, mcp.NewToolResultError("calendar not found"), now))
	assert.True(t, tracker.isRequired("google"), "an error without a link says nothing about the sign-in")

	assert.False(t, tracker.observe(google, mcp.NewToolResultText("3 calendars"), now))
	assert.False(t, tracker.isRequired("google"))

	link, ok := tracker.latest("google", now)
	require.True(t, ok, "the pending sign-in outlives the status")
	assert.Equal(t, "5f1d2c", link.state)
	_, ok = tracker.latest("google", now.Add(signInLifetime))
	assert.False(t, ok)
}

func TestSignInRelay_ProxyCallThroughCompletion(t *testing.T) {
	upstream := testhelpers.NewSignInUpstream()
	defer upstream.Close()
	service := newSignInTestService(t, upstream)
	ctx := context.Background()

	states, err := service.SignInStates()
	require.NoError(t, err)
	assert.Equal(t, types.SignInAvailable, states["demo"])

	// An agent's call through the proxy hands out a consent link and marks the server.
	req := mcp.CallToolRequest{}
	req.Params.Name = "demo__list_items"
	res, err := service.MCPProxyToolCallHandler(context.WithValue(ctx, "mode", model.ModeDev), req)
	require.NoError(t, err)
	require.True(t, res.IsError)
	states, err = service.SignInStates()
	require.NoError(t, err)
	assert.Equal(t, types.SignInRequired, states["demo"])

	// Minting calls start_demo_auth and leaves the mark alone.
	link, err := service.MintSignIn(ctx, "demo")
	require.NoError(t, err)
	assert.Contains(t, link, "/authorize?")
	assert.True(t, service.signIns.isRequired("demo"))

	landed := consent(t, link)
	assert.Equal(t, "localhost", landed.Hostname())

	result, err := service.CompleteSignIn(ctx, "demo", landed.String())
	require.NoError(t, err)
	assert.Equal(t, &types.SignInResult{SignedIn: true, UpstreamStatus: http.StatusOK, CheckedWith: "list_items"}, result)
	assert.True(t, upstream.SignedIn())
	states, err = service.SignInStates()
	require.NoError(t, err)
	assert.Equal(t, types.SignInAvailable, states["demo"])

	// One replay per sign-in.
	_, err = service.CompleteSignIn(ctx, "demo", landed.String())
	require.ErrorIs(t, err, apierrors.ErrInvalidInput)
	assert.Contains(t, err.Error(), "does not match")
}

func TestSignInRelay_InvokeToolMarksAndCallbackFailureIsReported(t *testing.T) {
	upstream := testhelpers.NewSignInUpstream()
	defer upstream.Close()
	service := newSignInTestService(t, upstream)
	ctx := context.Background()

	_, err := service.InvokeTool(ctx, "demo__list_items", map[string]any{})
	require.NoError(t, err)
	assert.True(t, service.signIns.isRequired("demo"))

	// Consent on the link the call carried, then forge the code.
	link, ok := service.signIns.latest("demo", time.Now())
	require.True(t, ok)
	landed := consent(t, link.authURL)
	query := landed.Query()
	query.Set("code", "forged")
	landed.RawQuery = query.Encode()

	result, err := service.CompleteSignIn(ctx, "demo", landed.String())
	require.NoError(t, err)
	assert.False(t, result.SignedIn)
	assert.Equal(t, http.StatusBadRequest, result.UpstreamStatus)
	assert.Equal(t, "demo's sign-in callback answered 400 Bad Request", result.Error)
	assert.False(t, upstream.SignedIn())
	assert.True(t, service.signIns.isRequired("demo"))
}

func TestMintSignIn_WithoutStartToolOrLink(t *testing.T) {
	upstream := testhelpers.NewSignInUpstream()
	defer upstream.Close()
	service := newSignInTestService(t, upstream)
	require.NoError(t, service.db.Where("name = ?", "start_demo_auth").Delete(&model.Tool{}).Error)

	_, err := service.MintSignIn(context.Background(), "demo")
	require.ErrorIs(t, err, apierrors.ErrConflict)
	assert.Equal(t, "demo has no tool that starts a sign-in, and none of its results in the last 10 minutes carried a sign-in link", err.Error())
}

func TestFillRequiredStrings(t *testing.T) {
	tests := []struct {
		name     string
		schema   string
		fallback string
		want     map[string]any
	}{
		{"workspace-mcp start_google_auth", `{"properties":{"service_name":{"type":"string"},"user_google_email":{"type":"string","default":"me@example.com"}},"required":["service_name"]}`, "google", map[string]any{"service_name": "google"}},
		{"enum wins", `{"properties":{"service":{"type":"string","enum":["gmail","drive"]}},"required":["service"]}`, "google", map[string]any{"service": "gmail"}},
		{"default wins over fallback", `{"properties":{"service":{"type":["string","null"],"default":"calendar"}},"required":["service"]}`, "google", map[string]any{"service": "calendar"}},
		{"nothing required", `{"properties":{"page_token":{"type":"string"}},"required":[]}`, "", map[string]any{}},
		{"empty schema", ``, "", map[string]any{}},
		{"unfillable without fallback", `{"properties":{"query":{"type":"string"}},"required":["query"]}`, "", nil},
		{"required number", `{"properties":{"limit":{"type":"integer"}},"required":["limit"]}`, "google", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args, ok := fillRequiredStrings([]byte(tt.schema), tt.fallback)
			assert.Equal(t, tt.want != nil, ok)
			assert.Equal(t, tt.want, args)
		})
	}
}

func TestVerifyToolPrefersCheapestListing(t *testing.T) {
	tools := []model.Tool{
		{Name: "search_gmail_messages", InputSchema: []byte(`{"required":[]}`)},
		{Name: "list_gmail_labels", InputSchema: []byte(`{"properties":{"user_google_email":{"type":"string","default":"me@example.com"}},"required":[]}`)},
		{Name: "list_events", InputSchema: []byte(`{"properties":{"calendar_id":{"type":"string","default":"primary"}},"required":["calendar_id"]}`)},
		{Name: "list_calendars", InputSchema: []byte(`{"properties":{"user_google_email":{"type":"string","default":"me@example.com"}},"required":[]}`)},
		{Name: "list_drive_items", InputSchema: []byte(`{"properties":{"folder_id":{"type":"string"}},"required":["folder_id"]}`)},
	}
	name, args, ok := verifyTool(tools)
	require.True(t, ok)
	assert.Equal(t, "list_calendars", name)
	assert.Empty(t, args)

	_, _, ok = verifyTool(tools[:1])
	assert.False(t, ok)
}

// newSignInTestService registers the fake upstream as "demo".
func newSignInTestService(t *testing.T, upstream *testhelpers.SignInUpstream) *MCPService {
	t.Helper()
	service := newTestLifecycleService(t, setupTestDBForProxyAdditional(t))
	srv := createStreamableHTTPTestServer(t, "demo", upstream.URL)
	require.NoError(t, service.registerMcpServerWithoutOAuth(context.Background(), srv))
	return service
}

// consent plays the consent screen: it follows the link one hop and returns
// the callback address a browser would land on.
func consent(t *testing.T, link string) *url.URL {
	t.Helper()
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := noRedirect.Get(link)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusFound, resp.StatusCode)
	landed, err := url.Parse(resp.Header.Get("Location"))
	require.NoError(t, err)
	return landed
}

func TestOwnsCallback(t *testing.T) {
	redirect, err := url.Parse("http://localhost:8010/oauth2callback")
	require.NoError(t, err)
	remote := func(rawURL string) *model.McpServer {
		cfg, err := json.Marshal(model.StreamableHTTPConfig{URL: rawURL})
		require.NoError(t, err)
		return &model.McpServer{Name: "x", Transport: types.TransportStreamableHTTP, Config: cfg}
	}

	assert.True(t, ownsCallback(&model.McpServer{Name: "x", Transport: types.TransportStdio}, redirect), "a local command runs here")
	assert.True(t, ownsCallback(remote("http://127.0.0.1:8010/mcp"), redirect), "a loopback server names its own port")
	assert.False(t, ownsCallback(remote("http://127.0.0.1:9000/mcp"), redirect), "a loopback server cannot name another local port")
	assert.False(t, ownsCallback(remote("https://sigmie.com/mcp"), redirect), "a remote server cannot name a local callback")

	text := "Authorization URL: " + workspaceMCPLink
	_, found := findSignInLink(remote("https://sigmie.com/mcp"), mcp.NewToolResultText(text), time.Now())
	assert.False(t, found, "a remote server's link is not recorded")
}
