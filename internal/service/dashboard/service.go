package dashboard

import (
	"encoding/json"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/mcpjungle/mcpjungle/internal/model"
	"github.com/mcpjungle/mcpjungle/pkg/types"
	"github.com/mcpjungle/mcpjungle/pkg/version"
	"gorm.io/gorm"
)

type Service struct {
	db             *gorm.DB
	metricsEnabled bool
}

func NewService(db *gorm.DB, metricsEnabled bool) *Service {
	return &Service{db: db, metricsEnabled: metricsEnabled}
}

type serverInventory struct {
	model.McpServer
	// Counts reflect everything discovered from the upstream server, even if
	// the server or individual entity is currently disabled for proxy exposure.
	ToolCount        int
	EnabledToolCount int
	PromptCount      int
	ResourceCount    int
	LastEntitySeen   time.Time
}

// Servers returns the full server inventory with sanitized configuration
// summaries suitable for direct UI display.
func (s *Service) Servers() (*types.DashboardServersResponse, error) {
	inventory, err := s.loadServerInventory()
	if err != nil {
		return nil, err
	}

	resp := &types.DashboardServersResponse{
		Servers: make([]types.DashboardServer, 0, len(inventory)),
	}
	for _, inv := range inventory {
		summary := summarizeServerConfig(inv.McpServer)
		resp.Servers = append(resp.Servers, types.DashboardServer{
			Name:              inv.Name,
			Transport:         string(inv.Transport),
			Enabled:           inv.Enabled,
			ToolCount:         inv.ToolCount,
			EnabledToolCount:  inv.EnabledToolCount,
			PromptCount:       inv.PromptCount,
			ResourceCount:     inv.ResourceCount,
			LastDiscoveredAt:  formatTime(inv.LastEntitySeen),
			UpdatedAt:         formatTime(inv.UpdatedAt),
			ConnectionSummary: summary.SanitizedSummary,
			ConfigSummary:     summary,
		})
	}

	if len(resp.Servers) == 0 {
		resp.EmptyState = noServersEmptyState()
	}

	return resp, nil
}

func (s *Service) Tools() (*types.DashboardToolsResponse, error) {
	var tools []model.Tool
	if err := s.db.Preload("Server").Order("name asc").Find(&tools).Error; err != nil {
		return nil, err
	}

	resp := &types.DashboardToolsResponse{
		Tools: make([]types.DashboardTool, 0, len(tools)),
	}
	for _, tool := range tools {
		canonicalName := mergeServerName(tool.Server.Name, tool.Name, "__")
		annotations := decodeJSONMap(tool.Annotations)
		upstreamTitle, _ := annotations["title"].(string)
		resp.Tools = append(resp.Tools, types.DashboardTool{
			Name:           tool.Name,
			CanonicalName:  canonicalName,
			Title:          displayTitle(tool.Server.Name, tool.Name, upstreamTitle),
			Server:         tool.Server.Name,
			Description:    tool.Description,
			Enabled:        tool.Enabled,
			ServerEnabled:  tool.Server.Enabled,
			InputSchema:    decodeJSONMap(tool.InputSchema),
			InputPreview:   compactJSON(tool.InputSchema),
			Transport:      string(tool.Server.Transport),
			AnnotationKeys: sortedKeys(annotations),
		})
	}
	if len(resp.Tools) == 0 {
		resp.EmptyState = emptyState(
			"No tools discovered yet",
			"MCPJungle is running, but it has not discovered any tools from registered servers yet.",
			[]string{
				"mcpjungle list tools --server context7",
				"mcpjungle usage <tool-name>",
				`mcpjungle invoke <tool-name> --input '{"key": "value"}'`,
			},
		)
	}
	return resp, nil
}

func (s *Service) Prompts() (*types.DashboardPromptsResponse, error) {
	var prompts []model.Prompt
	if err := s.db.Preload("Server").Order("name asc").Find(&prompts).Error; err != nil {
		return nil, err
	}

	resp := &types.DashboardPromptsResponse{
		Prompts: make([]types.DashboardPrompt, 0, len(prompts)),
	}
	for _, prompt := range prompts {
		arguments := decodeJSONArray(prompt.Arguments)
		resp.Prompts = append(resp.Prompts, types.DashboardPrompt{
			Name:             prompt.Name,
			CanonicalName:    mergeServerName(prompt.Server.Name, prompt.Name, "__"),
			Title:            displayTitle(prompt.Server.Name, prompt.Name, ""),
			Server:           prompt.Server.Name,
			Description:      prompt.Description,
			Enabled:          prompt.Enabled,
			ServerEnabled:    prompt.Server.Enabled,
			Arguments:        arguments,
			ArgumentsPreview: compactJSONArray(arguments),
			Transport:        string(prompt.Server.Transport),
		})
	}
	if len(resp.Prompts) == 0 {
		resp.EmptyState = emptyState(
			"No prompts discovered yet",
			"Registered servers can expose prompt templates. None are currently available.",
			[]string{
				"mcpjungle list prompts",
				"mcpjungle get prompt <prompt-name>",
			},
		)
	}
	return resp, nil
}

func (s *Service) Resources() (*types.DashboardResourcesResponse, error) {
	var resources []model.Resource
	if err := s.db.Preload("Server").Order("name asc").Find(&resources).Error; err != nil {
		return nil, err
	}

	resp := &types.DashboardResourcesResponse{
		Resources: make([]types.DashboardResource, 0, len(resources)),
	}
	for _, resource := range resources {
		resp.Resources = append(resp.Resources, types.DashboardResource{
			URI:         resource.URI,
			Name:        resource.Name,
			Server:      resource.Server.Name,
			Description: resource.Description,
			MIMEType:    resource.MIMEType,
			Enabled:     resource.Enabled,
			Transport:   string(resource.Server.Transport),
		})
	}
	if len(resp.Resources) == 0 {
		resp.EmptyState = emptyState(
			"No resources discovered yet",
			"Registered servers can expose MCP resources. None are currently available.",
			[]string{
				"mcpjungle list resources",
				"mcpjungle get resource --read <uri>",
			},
		)
	}
	return resp, nil
}

// Diagnostics is intentionally stricter than Overview: its counts describe what
// is currently exposed through MCPJungle, not every entity ever discovered.
func (s *Service) Diagnostics(mode model.ServerMode, baseURL string) (*types.DashboardDiagnosticsResponse, error) {
	inventory, err := s.loadServerInventory()
	if err != nil {
		return nil, err
	}

	toolCount, promptCount, resourceCount, err := s.loadEntityCounts()
	if err != nil {
		return nil, err
	}

	resp := &types.DashboardDiagnosticsResponse{
		Version:              version.GetVersion(),
		Mode:                 string(mode),
		ConfigSource:         "database (server_config table)",
		Database:             s.db.Name(),
		EnabledTransports:    enabledTransports(inventory),
		PrimaryEndpoint:      strings.TrimRight(baseURL, "/") + "/mcp",
		TroubleshootingHints: collectTroubleshootingHints(inventory, toolCount, promptCount, resourceCount),
		ServerCount:          len(inventory),
		ToolCount:            toolCount,
		PromptCount:          promptCount,
		ResourceCount:        resourceCount,
	}
	if s.metricsEnabled {
		resp.MetricsEndpoint = strings.TrimRight(baseURL, "/") + "/metrics"
	}
	if len(inventory) == 0 {
		resp.EmptyState = noServersEmptyState()
	}
	return resp, nil
}

// loadServerInventory builds the server rows used throughout the dashboard.
func (s *Service) loadServerInventory() ([]serverInventory, error) {
	var servers []model.McpServer
	if err := s.db.Order("name asc").Find(&servers).Error; err != nil {
		return nil, err
	}

	toolCounts, err := groupedCounts[model.Tool](s.db)
	if err != nil {
		return nil, err
	}
	promptCounts, err := groupedCounts[model.Prompt](s.db)
	if err != nil {
		return nil, err
	}
	resourceCounts, err := groupedCounts[model.Resource](s.db)
	if err != nil {
		return nil, err
	}
	enabledToolCounts, err := groupedEnabledCounts[model.Tool](s.db)
	if err != nil {
		return nil, err
	}

	inventory := make([]serverInventory, 0, len(servers))
	for _, server := range servers {
		inventory = append(inventory, serverInventory{
			McpServer:        server,
			ToolCount:        toolCounts[server.ID],
			EnabledToolCount: enabledToolCounts[server.ID],
			PromptCount:      promptCounts[server.ID],
			ResourceCount:    resourceCounts[server.ID],
			LastEntitySeen:   server.UpdatedAt,
		})
	}
	return inventory, nil
}

// loadEntityCounts returns the number of entities currently exposed through the
// gateway after applying both server-level and per-entity enabled flags.
func (s *Service) loadEntityCounts() (int, int, int, error) {
	var toolCount int64
	if err := s.db.Model(&model.Tool{}).
		Joins("JOIN mcp_servers ON mcp_servers.id = tools.server_id").
		Where("tools.enabled = ? AND mcp_servers.enabled = ?", true, true).
		Count(&toolCount).Error; err != nil {
		return 0, 0, 0, err
	}
	var promptCount int64
	if err := s.db.Model(&model.Prompt{}).
		Joins("JOIN mcp_servers ON mcp_servers.id = prompts.server_id").
		Where("prompts.enabled = ? AND mcp_servers.enabled = ?", true, true).
		Count(&promptCount).Error; err != nil {
		return 0, 0, 0, err
	}
	var resourceCount int64
	if err := s.db.Model(&model.Resource{}).
		Joins("JOIN mcp_servers ON mcp_servers.id = resources.server_id").
		Where("resources.enabled = ? AND mcp_servers.enabled = ?", true, true).
		Count(&resourceCount).Error; err != nil {
		return 0, 0, 0, err
	}
	return int(toolCount), int(promptCount), int(resourceCount), nil
}

type groupedCountRow struct {
	ServerID uint
	Count    int
}

func groupedCounts[T any](db *gorm.DB) (map[uint]int, error) {
	var rows []groupedCountRow
	if err := db.Model(new(T)).
		Select("server_id, COUNT(*) AS count").
		Group("server_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	counts := make(map[uint]int, len(rows))
	for _, row := range rows {
		counts[row.ServerID] = row.Count
	}
	return counts, nil
}

func groupedEnabledCounts[T any](db *gorm.DB) (map[uint]int, error) {
	var rows []groupedCountRow
	if err := db.Model(new(T)).
		Select("server_id, COUNT(*) AS count").
		Where("enabled = ?", true).
		Group("server_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	counts := make(map[uint]int, len(rows))
	for _, row := range rows {
		counts[row.ServerID] = row.Count
	}
	return counts, nil
}

// summarizeServerConfig produces a UI-safe description of transport-specific
// server configuration. It deliberately strips or downgrades secret-bearing
// values such as Authorization headers, bearer tokens, and query params.
func summarizeServerConfig(server model.McpServer) types.DashboardServerConfigSummary {
	summary := types.DashboardServerConfigSummary{
		Kind:        string(server.Transport),
		SessionMode: string(server.SessionMode),
		Description: server.Description,
	}

	switch server.Transport {
	case types.TransportStreamableHTTP:
		if conf, err := server.GetStreamableHTTPConfig(); err == nil {
			summary.Target = sanitizeURL(conf.URL)
			summary.HeaderKeys = sortedHeaderKeys(conf.Headers)
			summary.SanitizedSummary = summary.Target
		}
	case types.TransportSSE:
		if conf, err := server.GetSSEConfig(); err == nil {
			summary.Target = sanitizeURL(conf.URL)
			summary.SanitizedSummary = summary.Target
		}
	case types.TransportStdio:
		if conf, err := server.GetStdioConfig(); err == nil {
			summary.Command = conf.Command
			summary.Target = buildServerCommand(conf.Command, conf.Args)
			summary.ArgumentCount = len(conf.Args)
			summary.EnvKeys = sortedKeysString(conf.Env)
			summary.SanitizedSummary = truncateServerCommand(conf.Command, conf.Args, 80)
		}
	}

	if summary.SanitizedSummary == "" {
		summary.SanitizedSummary = "Configuration summary unavailable"
	}

	return summary
}

func sanitizeURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func truncateServerCommand(command string, args []string, limit int) string {
	text := buildServerCommand(command, args)
	if text == "" {
		return ""
	}
	if len(text) <= limit {
		return text
	}
	if limit <= 3 {
		return text[:limit]
	}
	return strings.TrimSpace(text[:limit-3]) + "..."
}

func buildServerCommand(command string, args []string) string {
	parts := append([]string{command}, args...)
	return strings.TrimSpace(strings.Join(parts, " "))
}

func collectTroubleshootingHints(inventory []serverInventory, toolCount, promptCount, resourceCount int) []string {
	hints := []string{}
	if len(inventory) == 0 {
		hints = append(hints, "No servers registered yet")
	}
	if len(inventory) > 0 && toolCount == 0 {
		hints = append(hints, "Server registered but no tools discovered")
	}
	if len(inventory) > 0 && (promptCount == 0 || resourceCount == 0) {
		hints = append(hints, "Prompt/resource discovery failed")
	}
	hints = append(hints, "Check CLI logs for detailed errors")
	return hints
}

func noServersEmptyState() *types.DashboardEmptyState {
	return emptyState(
		"No servers registered yet",
		"Register an MCP server from the CLI, then refresh the dashboard to inspect tools, prompts, and resources.",
		[]string{
			"mcpjungle register --name context7 --url https://mcp.context7.com/mcp",
			"mcpjungle list servers",
		},
	)
}

func emptyState(title, description string, commands []string) *types.DashboardEmptyState {
	return &types.DashboardEmptyState{
		Title:       title,
		Description: description,
		Commands:    commands,
	}
}

func enabledTransports(inventory []serverInventory) []string {
	set := map[string]struct{}{
		string(types.TransportStreamableHTTP): {},
		string(types.TransportSSE):            {},
		string(types.TransportStdio):          {},
	}
	for _, server := range inventory {
		set[string(server.Transport)] = struct{}{}
	}

	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// decodeJSONMap/JSONArray are best-effort helpers for dashboard display. If an
// entity stores malformed JSON, the dashboard should degrade gracefully instead
// of failing the whole response.
func decodeJSONMap(raw []byte) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}

func decodeJSONArray(raw []byte) []map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var value []map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return value
}

func compactJSON(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return truncateString(string(encoded), 160)
}

func compactJSONArray(value []map[string]any) string {
	if len(value) == 0 {
		return ""
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return truncateString(string(encoded), 160)
}

func truncateString(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max-1] + "…"
}

func sortedKeys(value map[string]any) []string {
	if len(value) == 0 {
		return nil
	}
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedKeysString(value map[string]string) []string {
	if len(value) == 0 {
		return nil
	}
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedHeaderKeys(value map[string]string) []string {
	keys := sortedKeysString(value)
	filtered := make([]string, 0, len(keys))
	for _, key := range keys {
		// Avoid exposing the presence of credential-bearing Authorization headers
		// in dashboard summaries.
		if strings.EqualFold(key, "authorization") {
			continue
		}
		filtered = append(filtered, key)
	}
	return filtered
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func mergeServerName(serverName, itemName, separator string) string {
	if serverName == "" {
		return itemName
	}
	return serverName + separator + itemName
}

// displayTitle returns the name a person reads for a tool or prompt: the
// upstream's own title when it sets one, else the item name in sentence case
// with a leading server prefix dropped, so "asana_get_task" on server "asana"
// reads "Get task". Acronyms such as "LLM" keep their case.
func displayTitle(serverName, itemName, upstreamTitle string) string {
	if title := strings.TrimSpace(upstreamTitle); title != "" {
		return title
	}

	name := itemName
	if n := len(serverName); n > 0 && len(name) > n+1 &&
		strings.EqualFold(name[:n], serverName) && (name[n] == '_' || name[n] == '-') {
		name = name[n+1:]
	}

	words := splitWords(name)
	if len(words) == 0 {
		return itemName
	}
	for i, word := range words {
		if !isAcronym(word) {
			word = strings.ToLower(word)
		}
		if i == 0 {
			runes := []rune(word)
			runes[0] = unicode.ToUpper(runes[0])
			word = string(runes)
		}
		words[i] = word
	}
	return strings.Join(words, " ")
}

// splitWords splits snake_case, kebab-case, dotted and camelCase names into
// words. An upper-case run stays one word ("sampleLLM" -> "sample", "LLM").
func splitWords(name string) []string {
	runes := []rune(name)
	var words []string
	var current []rune
	flush := func() {
		if len(current) > 0 {
			words = append(words, string(current))
			current = nil
		}
	}
	for i, r := range runes {
		if r == '_' || r == '-' || r == '.' || r == '/' || unicode.IsSpace(r) {
			flush()
			continue
		}
		if unicode.IsUpper(r) && len(current) > 0 {
			prev := runes[i-1]
			nextIsLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
			if unicode.IsLower(prev) || unicode.IsDigit(prev) || (unicode.IsUpper(prev) && nextIsLower) {
				flush()
			}
		}
		current = append(current, r)
	}
	flush()
	return words
}

func isAcronym(word string) bool {
	letters := 0
	for _, r := range word {
		if unicode.IsLower(r) {
			return false
		}
		if unicode.IsLetter(r) {
			letters++
		}
	}
	return letters >= 2
}
