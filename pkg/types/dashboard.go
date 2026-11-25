package types

type DashboardEmptyState struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Commands    []string `json:"commands,omitempty"`
}

type DashboardServerConfigSummary struct {
	Kind             string   `json:"kind"`
	Target           string   `json:"target,omitempty"`
	Command          string   `json:"command,omitempty"`
	ArgumentCount    int      `json:"argument_count,omitempty"`
	EnvKeys          []string `json:"env_keys,omitempty"`
	HeaderKeys       []string `json:"header_keys,omitempty"`
	SessionMode      string   `json:"session_mode,omitempty"`
	Description      string   `json:"description,omitempty"`
	SanitizedSummary string   `json:"sanitized_summary"`
}

type DashboardServer struct {
	Name      string `json:"name"`
	Transport string `json:"transport"`
	Enabled   bool   `json:"enabled"`
	ToolCount int    `json:"tool_count"`
	// EnabledToolCount counts tools whose own switch is on. Agents see a tool
	// only while both that switch and its server are on.
	EnabledToolCount  int                          `json:"enabled_tool_count"`
	PromptCount       int                          `json:"prompt_count"`
	ResourceCount     int                          `json:"resource_count"`
	LastDiscoveredAt  string                       `json:"last_discovered_at,omitempty"`
	UpdatedAt         string                       `json:"updated_at,omitempty"`
	ConnectionSummary string                       `json:"connection_summary"`
	ConfigSummary     DashboardServerConfigSummary `json:"config_summary"`
	SignIn            SignInState                  `json:"sign_in,omitempty"`
}

// SignInState is what the gateway knows about an upstream that runs its own
// sign-in with a redirect to the gateway host's loopback. Empty when neither
// applies.
type SignInState string

const (
	// SignInAvailable means the upstream has a tool that starts a sign-in.
	SignInAvailable SignInState = "available"
	// SignInRequired means the upstream's last tool result handed out a sign-in link.
	SignInRequired SignInState = "required"
)

// DashboardSignInLink is a fresh consent link for an upstream's own sign-in.
type DashboardSignInLink struct {
	AuthorizationURL string `json:"authorization_url"`
}

// DashboardSignInCompleteRequest carries the address the operator's browser
// landed on after the consent screen.
type DashboardSignInCompleteRequest struct {
	URL string `json:"url"`
}

// SignInResult is what relaying a sign-in callback to an upstream did.
type SignInResult struct {
	SignedIn bool `json:"signed_in"`
	// UpstreamStatus is the HTTP status the upstream's callback answered; 0 when it was not reached.
	UpstreamStatus int `json:"upstream_status,omitempty"`
	// CheckedWith names the read-only tool whose result confirmed the sign-in.
	CheckedWith string `json:"checked_with,omitempty"`
	Error       string `json:"error,omitempty"`
}

type DashboardServersResponse struct {
	Servers    []DashboardServer    `json:"servers"`
	EmptyState *DashboardEmptyState `json:"empty_state,omitempty"`
}

type DashboardTool struct {
	Name           string         `json:"name"`
	CanonicalName  string         `json:"canonical_name"`
	Title          string         `json:"title"`
	Server         string         `json:"server"`
	Description    string         `json:"description"`
	Enabled        bool           `json:"enabled"`
	ServerEnabled  bool           `json:"server_enabled"`
	InputSchema    map[string]any `json:"input_schema,omitempty"`
	InputPreview   string         `json:"input_preview,omitempty"`
	Transport      string         `json:"transport,omitempty"`
	AnnotationKeys []string       `json:"annotation_keys,omitempty"`
}

type DashboardToolsResponse struct {
	Tools      []DashboardTool      `json:"tools"`
	EmptyState *DashboardEmptyState `json:"empty_state,omitempty"`
}

type DashboardPrompt struct {
	Name             string           `json:"name"`
	CanonicalName    string           `json:"canonical_name"`
	Title            string           `json:"title"`
	Server           string           `json:"server"`
	Description      string           `json:"description"`
	Enabled          bool             `json:"enabled"`
	ServerEnabled    bool             `json:"server_enabled"`
	Arguments        []map[string]any `json:"arguments,omitempty"`
	ArgumentsPreview string           `json:"arguments_preview,omitempty"`
	Transport        string           `json:"transport,omitempty"`
}

type DashboardPromptsResponse struct {
	Prompts    []DashboardPrompt    `json:"prompts"`
	EmptyState *DashboardEmptyState `json:"empty_state,omitempty"`
}

type DashboardResource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Server      string `json:"server"`
	Description string `json:"description"`
	MIMEType    string `json:"mime_type,omitempty"`
	Enabled     bool   `json:"enabled"`
	Transport   string `json:"transport,omitempty"`
}

type DashboardResourcesResponse struct {
	Resources  []DashboardResource  `json:"resources"`
	EmptyState *DashboardEmptyState `json:"empty_state,omitempty"`
}

type DashboardDiagnosticsResponse struct {
	Version              string               `json:"version"`
	Mode                 string               `json:"mode"`
	ConfigSource         string               `json:"config_source,omitempty"`
	ConfigPath           string               `json:"config_path,omitempty"`
	Database             string               `json:"database"`
	EnabledTransports    []string             `json:"enabled_transports"`
	MetricsEndpoint      string               `json:"metrics_endpoint,omitempty"`
	PrimaryEndpoint      string               `json:"primary_endpoint"`
	TroubleshootingHints []string             `json:"troubleshooting_hints"`
	ServerCount          int                  `json:"server_count"`
	ToolCount            int                  `json:"tool_count"`
	PromptCount          int                  `json:"prompt_count"`
	ResourceCount        int                  `json:"resource_count"`
	EmptyState           *DashboardEmptyState `json:"empty_state,omitempty"`
}
