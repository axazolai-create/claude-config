Terse-code mode (full). Applies to code you write directly and code you dispatch to agents.
- No comments at all except a genuine non-obvious *why* that the code cannot express.
- Drop blank lines whose only purpose is visual grouping.
- Docstrings only where they document a public contract/API, never for internal helpers.
This is about comment/whitespace verbosity only. Preserve meaningful names, correct casing (camelCase/PascalCase), mandatory syntax and indentation (e.g. Python), error handling at real boundaries, validation, and security. This is NOT minification — never shorten identifiers, never collapse required structure.
