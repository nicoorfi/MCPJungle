package mcp

// Loopback sign-in relay.
//
// Some upstreams run their own OAuth with a desktop-type client. When their
// grant dies, each tool result carries a consent link whose redirect_uri is
// http://localhost:<port>/..., which only the gateway host serves. The
// operator's browser runs elsewhere, so the consent screen ends on a "can't
// connect" page. The operator pastes that page's address into the dashboard,
// and Jungle replays it to the upstream over the gateway host's loopback.
//
//	tool result ── findSignInLink ──▶ pending sign-in, server marked "required"
//	dashboard: mint ──▶ start-auth tool's link, else the latest pending link
//	browser: consent ──▶ http://localhost:<port>/<path>?state=…&code=…
//	dashboard: complete ──▶ signInCallbackTarget ──▶ GET 127.0.0.1:<port>/<path>?…
//	                                                  └▶ one list tool confirms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mcpjungle/mcpjungle/internal/model"
	"github.com/mcpjungle/mcpjungle/pkg/apierrors"
	"github.com/mcpjungle/mcpjungle/pkg/types"
)

// signInLifetime is how long a consent link stays usable. workspace-mcp, the
// upstream this was built for, forgets its OAuth state after ten minutes.
const signInLifetime = 10 * time.Minute

// pendingSignIn is a consent link an upstream handed out whose redirect lands
// on the gateway host's loopback.
type pendingSignIn struct {
	authURL  string
	redirect *url.URL
	state    string
	seenAt   time.Time
}

// signInTracker holds, per server name, the pending sign-ins and whether the
// server's latest tool result asked for one. Both live in memory only: a
// restart forgets them, and the next tool call reports again.
// The zero value is ready to use.
type signInTracker struct {
	mu       sync.Mutex
	pending  map[string]map[string]pendingSignIn // server -> state -> sign-in
	required map[string]bool
}

// observe records what a tool result says about its server's sign-in and
// reports whether the result asked for one. A consent link marks the server;
// a successful result without one clears the mark. An error result without a
// link says nothing about the sign-in, so it leaves the mark as it is.
func (t *signInTracker) observe(s *model.McpServer, res *mcp.CallToolResult, now time.Time) bool {
	server := s.Name
	link, found := findSignInLink(s, res, now)
	t.mu.Lock()
	defer t.mu.Unlock()
	switch {
	case found:
		t.addLocked(server, link, now)
		if t.required == nil {
			t.required = make(map[string]bool)
		}
		t.required[server] = true
	case !res.IsError:
		delete(t.required, server)
	}
	return found
}

// add records a link the dashboard minted. Asking for a link is not evidence
// that the old sign-in failed, so it leaves the server's mark alone.
func (t *signInTracker) add(server string, link pendingSignIn, now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.addLocked(server, link, now)
}

func (t *signInTracker) addLocked(server string, link pendingSignIn, now time.Time) {
	if t.pending == nil {
		t.pending = make(map[string]map[string]pendingSignIn)
	}
	links := t.pending[server]
	if links == nil {
		links = make(map[string]pendingSignIn)
		t.pending[server] = links
	}
	for state, old := range links {
		if now.Sub(old.seenAt) >= signInLifetime {
			delete(links, state)
		}
	}
	links[link.state] = link
}

// latest returns the server's newest unexpired pending link.
func (t *signInTracker) latest(server string, now time.Time) (pendingSignIn, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	var newest pendingSignIn
	found := false
	for _, link := range t.pending[server] {
		if now.Sub(link.seenAt) < signInLifetime && (!found || link.seenAt.After(newest.seenAt)) {
			newest, found = link, true
		}
	}
	return newest, found
}

// take checks landed against the server's pending sign-ins and, when it
// passes, removes the matched sign-in and returns the URL to replay. Each
// pending sign-in allows one replay: the upstream consumes its state on the
// first callback, and a second replay could only fail or repeat a request.
func (t *signInTracker) take(server, landed string, now time.Time) (*url.URL, pendingSignIn, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	target, link, err := signInCallbackTarget(landed, t.pending[server], now)
	if err != nil {
		return nil, pendingSignIn{}, err
	}
	delete(t.pending[server], link.state)
	return target, link, nil
}

func (t *signInTracker) signedIn(server string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.required, server)
}

func (t *signInTracker) isRequired(server string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.required[server]
}

func (t *signInTracker) forget(server string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.pending, server)
	delete(t.required, server)
}

// linkPattern finds http(s) URLs in tool text. A URL ends at whitespace or at
// a quote or bracket, the characters that wrap links in Markdown and HTML.
var linkPattern = regexp.MustCompile(`https?://[^\s"'<>()\[\]]+`)

// findSignInLink returns the first consent link in the result's text content
// whose callback the server may name (ownsCallback).
func findSignInLink(s *model.McpServer, res *mcp.CallToolResult, now time.Time) (pendingSignIn, bool) {
	owns := func(redirect *url.URL) bool { return ownsCallback(s, redirect) }
	for _, content := range res.Content {
		text, ok := mcp.AsTextContent(content)
		if !ok {
			continue
		}
		if link, ok := parseSignInLink(text.Text, now, owns); ok {
			return link, true
		}
	}
	return pendingSignIn{}, false
}

// parseSignInLink returns the first URL in text that carries a state and a
// redirect_uri Jungle can replay. Without a state, Jungle could not tell that
// link's callback from any other loopback URL, so such a link does not count.
func parseSignInLink(text string, now time.Time, owns func(*url.URL) bool) (pendingSignIn, bool) {
	for _, raw := range linkPattern.FindAllString(text, -1) {
		// Sentence punctuation and Markdown emphasis that follow a bare link.
		raw = strings.TrimRight(raw, ".,;:!?*_")
		u, err := url.Parse(raw)
		if err != nil {
			continue
		}
		query := u.Query()
		state := query.Get("state")
		redirect, err := url.Parse(query.Get("redirect_uri"))
		if err != nil || state == "" || !isRelayableRedirect(redirect) || !owns(redirect) {
			continue
		}
		return pendingSignIn{authURL: raw, redirect: redirect, state: state, seenAt: now}, true
	}
	return pendingSignIn{}, false
}

// isRelayableRedirect accepts plain http to localhost or 127.0.0.1. The relay
// dials only 127.0.0.1, so a redirect to another loopback address (127.0.0.2,
// ::1) names a listener Jungle would miss. Loopback redirects are plain http
// because that is what OAuth providers allow for them.
func isRelayableRedirect(u *url.URL) bool {
	host := strings.ToLower(u.Hostname())
	return u.Scheme == "http" && (host == "localhost" || host == "127.0.0.1")
}

// ownsCallback reports whether s may name redirect as its sign-in callback.
// Jungle later sends the pasted callback to that port on its own loopback, so
// only a server on this machine may name one: a local command (it runs here and
// opened the listener), or an HTTP server on loopback, and then only its own
// port. Without this rule a remote server's reply could choose which local
// service Jungle calls once the operator pastes an address.
func ownsCallback(s *model.McpServer, redirect *url.URL) bool {
	var raw string
	switch s.Transport {
	case types.TransportStdio:
		return true
	case types.TransportStreamableHTTP:
		c, err := s.GetStreamableHTTPConfig()
		if err != nil {
			return false
		}
		raw = c.URL
	case types.TransportSSE:
		c, err := s.GetSSEConfig()
		if err != nil {
			return false
		}
		raw = c.URL
	default:
		return false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return portOrDefault(u) == portOrDefault(redirect)
	}
	return false
}

// signInCallbackTarget checks an address the operator pasted after a consent
// screen and returns the one URL Jungle may fetch for it. The endpoint that
// calls it turns operator input into a request from the gateway host to its
// own loopback, so each rule narrows what that request can be:
//
//  1. The address parses as an absolute URL. Anything else is a paste error.
//  2. Its state names a pending sign-in of this server. The state is the only
//     proof that the address answers a link this upstream handed out. Without
//     it, Jungle would replay any loopback URL that reaches the field.
//  3. That sign-in is younger than signInLifetime. The upstream forgets its
//     state by then, and the bound limits how long a leaked link stays
//     replayable.
//  4. Host, port and path equal the sign-in's redirect_uri. The upstream named
//     that callback. Another loopback endpoint (another local service, another
//     path of this one) stays out of reach even with a valid state.
//  5. The target is rebuilt, never copied: http, 127.0.0.1, the redirect's port
//     and path, the pasted query. A pasted scheme, user info, host or fragment
//     never reaches the request, and an IP literal cannot resolve elsewhere.
//
// Refusals name the rule in plain words and never echo the address, whose
// query holds the authorization code.
func signInCallbackTarget(landed string, pending map[string]pendingSignIn, now time.Time) (*url.URL, pendingSignIn, error) {
	u, err := url.Parse(strings.TrimSpace(landed))
	if err != nil || !u.IsAbs() || u.Host == "" {
		return nil, pendingSignIn{}, refuse("Paste the full address from the browser's address bar")
	}
	state := u.Query().Get("state")
	if state == "" {
		return nil, pendingSignIn{}, refuse("This address has no state, so it is not the end of a sign-in")
	}
	link, ok := pending[state]
	if !ok {
		return nil, pendingSignIn{}, refuse("This address does not match a sign-in Jungle started for this connection. Open the sign-in page again")
	}
	if now.Sub(link.seenAt) >= signInLifetime {
		return nil, pendingSignIn{}, refuse(fmt.Sprintf("This sign-in expired after %d minutes. Open the sign-in page again", int(signInLifetime.Minutes())))
	}
	if !strings.EqualFold(u.Hostname(), link.redirect.Hostname()) {
		return nil, pendingSignIn{}, refuse(fmt.Sprintf("The address must be on %s, where the sign-in sends the browser", link.redirect.Hostname()))
	}
	if portOrDefault(u) != portOrDefault(link.redirect) {
		return nil, pendingSignIn{}, refuse(fmt.Sprintf("The address must use port %s, where the sign-in sends the browser", portOrDefault(link.redirect)))
	}
	if u.EscapedPath() != link.redirect.EscapedPath() {
		return nil, pendingSignIn{}, refuse(fmt.Sprintf("The address must end at %s, where the sign-in sends the browser", link.redirect.EscapedPath()))
	}
	target := &url.URL{
		Scheme:   "http",
		Host:     "127.0.0.1:" + portOrDefault(link.redirect),
		Path:     link.redirect.Path,
		RawPath:  link.redirect.RawPath,
		RawQuery: u.RawQuery,
	}
	return target, link, nil
}

func portOrDefault(u *url.URL) string {
	if port := u.Port(); port != "" {
		return port
	}
	if u.Scheme == "https" {
		return "443"
	}
	return "80"
}

// refuse is a completion the trust rules turned down. It reads as its reason
// alone, so the dashboard can show it as is, and maps to 400.
func refuse(reason string) error {
	return plainError{msg: reason, kind: apierrors.ErrInvalidInput}
}

// plainError reads as its message alone while still matching kind with errors.Is.
type plainError struct {
	msg  string
	kind error
}

func (e plainError) Error() string        { return e.msg }
func (e plainError) Is(target error) bool { return target == e.kind }

// signInRelayClient replays callbacks. It has no proxy, so the request goes
// to 127.0.0.1 itself. It follows no redirect, since a redirect would send
// Jungle to a URL the rules never checked. The timeout is short because a
// callback only trades the code for a token.
var signInRelayClient = &http.Client{
	Timeout:   10 * time.Second,
	Transport: &http.Transport{Proxy: nil},
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// replaySignInCallback sends the GET the browser could not, and returns the
// upstream's status.
func replaySignInCallback(ctx context.Context, target *url.URL, host string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return 0, err
	}
	// Upstreams rebuild the authorization response from the request URL, so
	// present the host the browser would have sent.
	req.Host = host
	resp, err := signInRelayClient.Do(req)
	if err != nil {
		// A *url.Error repeats the URL, code included. Keep only the cause.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	return resp.StatusCode, nil
}

// MintSignIn returns a fresh consent link for the server: from its start-auth
// tool when it has one, else the newest link one of its results carried.
func (m *MCPService) MintSignIn(ctx context.Context, name string) (string, error) {
	s, tools, err := m.serverToolRows(name)
	if err != nil {
		return "", err
	}
	tool, args, hasStart := startAuthTool(tools, s.Name)
	if hasStart {
		res, err := m.callTool(ctx, s, toolRequest(tool, args))
		if err != nil {
			return "", fmt.Errorf("%s failed: %w", tool, err)
		}
		now := time.Now()
		if link, found := findSignInLink(s, res, now); found {
			m.signIns.add(s.Name, link, now)
			return link.authURL, nil
		}
	}
	if link, ok := m.signIns.latest(s.Name, time.Now()); ok {
		return link.authURL, nil
	}
	if hasStart {
		return "", plainError{msg: fmt.Sprintf("%s returned no sign-in link", tool), kind: apierrors.ErrConflict}
	}
	return "", plainError{
		msg:  fmt.Sprintf("%s has no tool that starts a sign-in, and none of its results in the last %d minutes carried a sign-in link", s.Name, int(signInLifetime.Minutes())),
		kind: apierrors.ErrConflict,
	}
}

// CompleteSignIn replays the address the operator's browser landed on to the
// server's callback, then confirms the sign-in with one read-only tool call.
// A refused address is an error; anything after the replay is in the result.
func (m *MCPService) CompleteSignIn(ctx context.Context, name, landed string) (*types.SignInResult, error) {
	s, tools, err := m.serverToolRows(name)
	if err != nil {
		return nil, err
	}
	target, link, err := m.signIns.take(s.Name, landed, time.Now())
	if err != nil {
		return nil, err
	}
	status, err := replaySignInCallback(ctx, target, link.redirect.Host)
	if err != nil {
		return &types.SignInResult{Error: fmt.Sprintf("Could not reach %s's sign-in callback on port %s: %v", s.Name, target.Port(), err)}, nil
	}
	result := &types.SignInResult{UpstreamStatus: status}
	if status < 200 || status > 299 {
		result.Error = fmt.Sprintf("%s's sign-in callback answered %d %s", s.Name, status, http.StatusText(status))
		return result, nil
	}

	tool, args, ok := verifyTool(tools)
	if !ok {
		// Nothing to confirm with: the callback's answer is the only evidence.
		m.signIns.signedIn(s.Name)
		result.SignedIn = true
		return result, nil
	}
	result.CheckedWith = tool
	res, err := m.callTool(ctx, s, toolRequest(tool, args))
	switch {
	case err != nil:
		result.Error = fmt.Sprintf("The callback answered %d, but %s failed: %v", status, tool, err)
	case m.signIns.observe(s, res, time.Now()):
		result.Error = fmt.Sprintf("The callback answered %d, but %s still asks for a sign-in", status, tool)
	case res.IsError:
		result.Error = fmt.Sprintf("The callback answered %d, but %s returned an error", status, tool)
	default:
		result.SignedIn = true
	}
	return result, nil
}

// SignInStates returns the sign-in state of every server that has one.
func (m *MCPService) SignInStates() (map[string]types.SignInState, error) {
	var tools []model.Tool
	if err := m.db.Preload("Server").Find(&tools).Error; err != nil {
		return nil, fmt.Errorf("failed to list tools: %w", err)
	}
	byServer := make(map[string][]model.Tool)
	for _, tool := range tools {
		byServer[tool.Server.Name] = append(byServer[tool.Server.Name], tool)
	}
	states := make(map[string]types.SignInState)
	for server, serverTools := range byServer {
		if m.signIns.isRequired(server) {
			states[server] = types.SignInRequired
		} else if _, _, ok := startAuthTool(serverTools, server); ok {
			states[server] = types.SignInAvailable
		}
	}
	return states, nil
}

// serverToolRows returns the server and its tool rows, named as the upstream knows them.
func (m *MCPService) serverToolRows(name string) (*model.McpServer, []model.Tool, error) {
	s, err := m.GetMcpServer(name)
	if err != nil {
		return nil, nil, err
	}
	var tools []model.Tool
	if err := m.db.Where("server_id = ?", s.ID).Order("name asc").Find(&tools).Error; err != nil {
		return nil, nil, fmt.Errorf("failed to get tools for server %s: %w", name, err)
	}
	return s, tools, nil
}

func toolRequest(name string, args map[string]any) mcp.CallToolRequest {
	req := mcp.CallToolRequest{}
	req.Params.Name = name
	req.Params.Arguments = args
	return req
}

// startAuthTool picks the tool that hands out a fresh consent link.
// Heuristic: its name is start_<…>auth<…> (workspace-mcp: start_google_auth).
// A required string input that the schema does not settle gets the server's
// name: workspace-mcp's service_name only labels its message.
func startAuthTool(tools []model.Tool, serverName string) (string, map[string]any, bool) {
	for _, tool := range tools {
		name := strings.ToLower(tool.Name)
		if !strings.HasPrefix(name, "start_") || !strings.Contains(strings.TrimPrefix(name, "start_"), "auth") {
			continue
		}
		if args, ok := fillRequiredStrings(tool.InputSchema, serverName); ok {
			return tool.Name, args, true
		}
	}
	return "", nil, false
}

// verifyTool picks the cheapest read-only call that proves a sign-in works.
// Heuristic: a tool whose name starts with "list" and whose required inputs
// the schema fills by itself, fewest inputs first, then by name. For
// workspace-mcp that is list_calendars, which takes user_google_email from
// its default.
func verifyTool(tools []model.Tool) (string, map[string]any, bool) {
	type candidate struct {
		name string
		args map[string]any
	}
	var candidates []candidate
	for _, tool := range tools {
		if !strings.HasPrefix(strings.ToLower(tool.Name), "list") {
			continue
		}
		if args, ok := fillRequiredStrings(tool.InputSchema, ""); ok {
			candidates = append(candidates, candidate{tool.Name, args})
		}
	}
	if len(candidates) == 0 {
		return "", nil, false
	}
	sort.Slice(candidates, func(i, j int) bool {
		if len(candidates[i].args) != len(candidates[j].args) {
			return len(candidates[i].args) < len(candidates[j].args)
		}
		return candidates[i].name < candidates[j].name
	})
	return candidates[0].name, candidates[0].args, true
}

// fillRequiredStrings builds the arguments for a call nobody typed. Each
// required input gets its schema's first enum value, else its default, else
// fallback when fallback is not empty. A required input that is not a string,
// or that none of these fill, makes the tool uncallable.
func fillRequiredStrings(schema []byte, fallback string) (map[string]any, bool) {
	var parsed struct {
		Properties map[string]struct {
			Type    any   `json:"type"`
			Enum    []any `json:"enum"`
			Default any   `json:"default"`
		} `json:"properties"`
		Required []string `json:"required"`
	}
	if len(schema) > 0 {
		if err := json.Unmarshal(schema, &parsed); err != nil {
			return nil, false
		}
	}
	args := make(map[string]any, len(parsed.Required))
	for _, name := range parsed.Required {
		property := parsed.Properties[name]
		if !allowsString(property.Type) {
			return nil, false
		}
		value := fallback
		if len(property.Enum) > 0 {
			value, _ = property.Enum[0].(string)
		} else if def, ok := property.Default.(string); ok && def != "" {
			value = def
		}
		if value == "" {
			return nil, false
		}
		args[name] = value
	}
	return args, true
}

// allowsString reports whether a JSON schema type admits a string. A missing
// type admits anything.
func allowsString(schemaType any) bool {
	switch t := schemaType.(type) {
	case nil:
		return true
	case string:
		return t == "string"
	case []any:
		for _, item := range t {
			if item == "string" {
				return true
			}
		}
	}
	return false
}
