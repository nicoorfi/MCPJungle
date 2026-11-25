package testhelpers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// SignInUpstream is a fake MCP server that signs in the way workspace-mcp
// does. Until its loopback callback is hit with a code it issued, every tool
// answers with a consent link whose redirect_uri is that callback.
//
//	GET  /mcp            MCP over streamable HTTP
//	                     list_items       a listing; asks for a sign-in until signed in
//	                     start_demo_auth  mints a consent link (requires service_name)
//	GET  /authorize      the consent screen: redirects to the callback with a code
//	GET  /oauth2callback signs in when state and code match, else 400
type SignInUpstream struct {
	// URL is the MCP endpoint.
	URL string

	server   *httptest.Server
	mu       sync.Mutex
	codes    map[string]string // state -> code, until the callback consumes it
	signedIn bool
}

// NewSignInUpstream starts the fake on 127.0.0.1. Close stops it.
func NewSignInUpstream() *SignInUpstream {
	u := &SignInUpstream{codes: make(map[string]string)}

	mcpServer := server.NewMCPServer("signin-upstream", "0.1.0", server.WithToolCapabilities(true))
	mcpServer.AddTool(
		mcp.NewTool("list_items", mcp.WithDescription("Lists the items"), mcp.WithReadOnlyHintAnnotation(true)),
		func(context.Context, mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			if !u.SignedIn() {
				return mcp.NewToolResultError(u.consentMessage()), nil
			}
			return mcp.NewToolResultText("apples, pears"), nil
		},
	)
	mcpServer.AddTool(
		mcp.NewTool("start_demo_auth", mcp.WithDescription("Starts a sign-in"), mcp.WithString("service_name", mcp.Required())),
		func(context.Context, mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return mcp.NewToolResultText(u.consentMessage()), nil
		},
	)

	mux := http.NewServeMux()
	mux.Handle("/mcp", server.NewStreamableHTTPServer(mcpServer))
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		state := r.URL.Query().Get("state")
		u.mu.Lock()
		code, ok := u.codes[state]
		u.mu.Unlock()
		if !ok {
			http.Error(w, "unknown state", http.StatusBadRequest)
			return
		}
		http.Redirect(w, r, u.callbackURL()+"?state="+url.QueryEscape(state)+"&code="+url.QueryEscape(code), http.StatusFound)
	})
	mux.HandleFunc("/oauth2callback", func(w http.ResponseWriter, r *http.Request) {
		state, code := r.URL.Query().Get("state"), r.URL.Query().Get("code")
		u.mu.Lock()
		defer u.mu.Unlock()
		want, ok := u.codes[state]
		if !ok || code != want {
			http.Error(w, "Authentication failed", http.StatusBadRequest)
			return
		}
		delete(u.codes, state)
		u.signedIn = true
		_, _ = fmt.Fprintln(w, "Signed in. You can close this tab.")
	})

	u.server = httptest.NewServer(mux)
	u.URL = u.server.URL + "/mcp"
	return u
}

// Close stops the fake.
func (u *SignInUpstream) Close() { u.server.Close() }

// SignedIn reports whether a callback succeeded.
func (u *SignInUpstream) SignedIn() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.signedIn
}

// SignOut forgets the sign-in, the way a dead refresh token does.
func (u *SignInUpstream) SignOut() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.signedIn = false
}

// callbackURL is where the consent screen sends the browser: localhost, like
// a desktop OAuth client, while the server listens on 127.0.0.1.
func (u *SignInUpstream) callbackURL() string {
	parsed, _ := url.Parse(u.server.URL)
	return "http://localhost:" + parsed.Port() + "/oauth2callback"
}

// consentMessage mints a state and code and returns workspace-mcp's wording.
func (u *SignInUpstream) consentMessage() string {
	state, code := randomHex(), randomHex()
	u.mu.Lock()
	u.codes[state] = code
	u.mu.Unlock()
	link := u.server.URL + "/authorize?" + url.Values{
		"client_id":     {"demo"},
		"response_type": {"code"},
		"redirect_uri":  {u.callbackURL()},
		"state":         {state},
	}.Encode()
	return "**ACTION REQUIRED: Authentication Needed**\n\n1. Open this URL in your browser:\n   Authorization URL: " + link + "\n2. After authorizing, retry your original request."
}

func randomHex() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
