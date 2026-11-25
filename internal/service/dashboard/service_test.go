package dashboard

import "testing"

func TestDisplayTitle(t *testing.T) {
	cases := []struct {
		server, name, upstream, want string
	}{
		{"asana", "asana_get_task", "", "Get task"},
		{"asana", "Asana-search-projects", "", "Search projects"},
		{"everything", "getTinyImage", "", "Get tiny image"},
		{"everything", "sampleLLM", "", "Sample LLM"},
		{"everything", "get-sum", "", "Get sum"},
		{"everything", "echo", "", "Echo"},
		{"google", "search_gmail_messages", "", "Search gmail messages"},
		{"fs", "read_file", "Read a file", "Read a file"},
		{"asana", "asana_", "", "Asana"},
		{"x", "LLMTool", "", "LLM tool"},
	}
	for _, c := range cases {
		if got := displayTitle(c.server, c.name, c.upstream); got != c.want {
			t.Errorf("displayTitle(%q, %q, %q) = %q, want %q", c.server, c.name, c.upstream, got, c.want)
		}
	}
}
