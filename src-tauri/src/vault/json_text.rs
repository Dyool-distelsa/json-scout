//! Lossless JSON text handling.
//!
//! A secret that is edited and pushed back must change only the bytes the user
//! edited. Going through `serde_json::Value` cannot promise that: it rewrites
//! numbers (`1.50` becomes `1.5`, big integers lose precision), collapses
//! duplicate keys and (without `preserve_order`) reorders them. This module
//! instead tokenises the text, validates it against the JSON grammar and
//! re-emits it with every string and number lexeme copied verbatim and with
//! every object member kept in its original order.
//!
//! - [`pretty`]: 2-space indentation and a trailing newline (the working copy).
//! - [`minify`]: strips insignificant whitespace only (the bytes that get
//!   pushed).
//! - [`duplicate_keys`]: reports repeated keys inside one object. Formatting
//!   keeps both members, so a pull of such a value still succeeds, and it is up
//!   to the caller to refuse to push it.
//!
//! Error values carry a position and a fixed reason, never any of the input,
//! because the input can be a secret.

use std::collections::HashSet;
use std::fmt;

/// Deepest container nesting accepted, matching `serde_json`'s own limit. The
/// parser is recursive and release builds abort on a stack overflow, so the
/// bound has to exist.
pub const MAX_DEPTH: usize = 128;

/// The text is not valid JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonTextError {
    /// 1-based line of the offending character.
    pub line: usize,
    /// 1-based column, counted in characters.
    pub column: usize,
    reason: &'static str,
}

impl fmt::Display for JsonTextError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid JSON at line {}, column {}: {}",
            self.line, self.column, self.reason
        )
    }
}

impl std::error::Error for JsonTextError {}

/// A key that appears more than once in the same object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateKey {
    /// Location of the repeated key, such as `$.a.b[2].c`.
    pub path: String,
    /// 1-based line of the repeated (second or later) occurrence.
    pub line: usize,
    /// 1-based column of the repeated occurrence.
    pub column: usize,
}

/// Re-emit `text` with 2-space indentation and a trailing newline.
pub fn pretty(text: &str) -> Result<String, JsonTextError> {
    let root = parse(text)?;
    let mut out = String::with_capacity(text.len() + text.len() / 4 + 1);
    write_pretty(&root, 0, &mut out);
    out.push('\n');
    Ok(out)
}

/// Re-emit `text` without any insignificant whitespace.
pub fn minify(text: &str) -> Result<String, JsonTextError> {
    let root = parse(text)?;
    let mut out = String::with_capacity(text.len());
    write_minified(&root, &mut out);
    Ok(out)
}

/// Whether `text` is a valid JSON object or array. A JSON scalar such as `123`
/// or `true` is indistinguishable from a plain password, so it does not count.
pub fn is_container(text: &str) -> bool {
    text.trim_start_matches([' ', '\t', '\n', '\r'])
        .starts_with(['{', '['])
        && parse(text).is_ok()
}

/// Every repeated key in `text`, in document order.
pub fn duplicate_keys(text: &str) -> Result<Vec<DuplicateKey>, JsonTextError> {
    let root = parse(text)?;
    let mut found = Vec::new();
    collect_duplicates(&root, text, &mut String::from("$"), &mut found);
    Ok(found)
}

/// A parsed value. Scalars and keys stay as slices of the source text, which
/// is what makes the round trip lossless.
enum Node<'a> {
    /// A string, number or literal exactly as written (strings keep their
    /// quotes).
    Scalar(&'a str),
    Array(Vec<Node<'a>>),
    Object(Vec<Member<'a>>),
}

struct Member<'a> {
    /// The key including its quotes.
    key: &'a str,
    /// Byte offset of the key in the source, for reporting.
    key_offset: usize,
    value: Node<'a>,
}

fn parse(text: &str) -> Result<Node<'_>, JsonTextError> {
    let mut parser = Parser {
        text,
        bytes: text.as_bytes(),
        pos: 0,
    };
    parser.skip_whitespace();
    let root = parser.value(0)?;
    parser.skip_whitespace();
    if parser.pos < parser.bytes.len() {
        return Err(parser.error("unexpected data after the value"));
    }
    Ok(root)
}

struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn error(&self, reason: &'static str) -> JsonTextError {
        let (line, column) = position(self.text, self.pos);
        JsonTextError {
            line,
            column,
            reason,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn expect(&mut self, byte: u8, reason: &'static str) -> Result<(), JsonTextError> {
        if self.peek() == Some(byte) {
            self.pos += 1;
            Ok(())
        } else {
            Err(self.error(reason))
        }
    }

    /// `depth` is the number of containers already open around this value.
    fn value(&mut self, depth: usize) -> Result<Node<'a>, JsonTextError> {
        match self.peek() {
            None => Err(self.error("unexpected end of input")),
            Some(b'{') => self.object(depth),
            Some(b'[') => self.array(depth),
            Some(b'"') => self.string().map(Node::Scalar),
            Some(b'-' | b'0'..=b'9') => self.number().map(Node::Scalar),
            Some(b't') => self.literal("true"),
            Some(b'f') => self.literal("false"),
            Some(b'n') => self.literal("null"),
            Some(_) => Err(self.error("unexpected character")),
        }
    }

    fn literal(&mut self, word: &'static str) -> Result<Node<'a>, JsonTextError> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            let start = self.pos;
            self.pos += word.len();
            Ok(Node::Scalar(&self.text[start..self.pos]))
        } else {
            Err(self.error("unexpected character"))
        }
    }

    fn object(&mut self, depth: usize) -> Result<Node<'a>, JsonTextError> {
        if depth >= MAX_DEPTH {
            return Err(self.error("nesting is too deep"));
        }
        self.pos += 1;
        let mut members = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Node::Object(members));
        }
        loop {
            self.skip_whitespace();
            if self.peek() != Some(b'"') {
                return Err(self.error("expected a string key"));
            }
            let key_offset = self.pos;
            let key = self.string()?;
            self.skip_whitespace();
            self.expect(b':', "expected ':' after a key")?;
            self.skip_whitespace();
            let value = self.value(depth + 1)?;
            members.push(Member {
                key,
                key_offset,
                value,
            });
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Node::Object(members));
                }
                _ => return Err(self.error("expected ',' or '}'")),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<Node<'a>, JsonTextError> {
        if depth >= MAX_DEPTH {
            return Err(self.error("nesting is too deep"));
        }
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Node::Array(items));
        }
        loop {
            self.skip_whitespace();
            items.push(self.value(depth + 1)?);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Node::Array(items));
                }
                _ => return Err(self.error("expected ',' or ']'")),
            }
        }
    }

    /// A string lexeme, quotes included. Slicing is safe: both ends sit on an
    /// ASCII quote.
    fn string(&mut self) -> Result<&'a str, JsonTextError> {
        let start = self.pos;
        self.pos += 1;
        loop {
            match self.peek() {
                None => return Err(self.error("unterminated string")),
                Some(b'"') => {
                    self.pos += 1;
                    return Ok(&self.text[start..self.pos]);
                }
                Some(b'\\') => {
                    self.pos += 1;
                    match self.peek() {
                        Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => {
                            self.pos += 1;
                        }
                        Some(b'u') => {
                            self.pos += 1;
                            for _ in 0..4 {
                                if !matches!(self.peek(), Some(b) if b.is_ascii_hexdigit()) {
                                    return Err(self.error("invalid unicode escape"));
                                }
                                self.pos += 1;
                            }
                        }
                        _ => return Err(self.error("invalid escape sequence")),
                    }
                }
                Some(byte) if byte < 0x20 => {
                    return Err(self.error("control character in a string"));
                }
                Some(_) => self.pos += 1,
            }
        }
    }

    /// `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`, kept as written.
    fn number(&mut self) -> Result<&'a str, JsonTextError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => self.skip_digits(),
            _ => return Err(self.error("invalid number")),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            self.require_digits()?;
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            self.require_digits()?;
        }
        Ok(&self.text[start..self.pos])
    }

    fn skip_digits(&mut self) {
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
    }

    fn require_digits(&mut self) -> Result<(), JsonTextError> {
        if !matches!(self.peek(), Some(b'0'..=b'9')) {
            return Err(self.error("invalid number"));
        }
        self.skip_digits();
        Ok(())
    }
}

/// 1-based line and character column of a byte offset.
fn position(text: &str, offset: usize) -> (usize, usize) {
    let end = offset.min(text.len());
    let before = &text.as_bytes()[..end];
    let line = before.iter().filter(|&&b| b == b'\n').count() + 1;
    let line_start = before
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |index| index + 1);
    // Count characters, not bytes: continuation bytes do not start one.
    let column = before[line_start..]
        .iter()
        .filter(|&&b| (b & 0xC0) != 0x80)
        .count()
        + 1;
    (line, column)
}

fn write_indent(depth: usize, out: &mut String) {
    for _ in 0..depth {
        out.push_str("  ");
    }
}

fn write_pretty(node: &Node<'_>, depth: usize, out: &mut String) {
    match node {
        Node::Scalar(lexeme) => out.push_str(lexeme),
        Node::Array(items) if items.is_empty() => out.push_str("[]"),
        Node::Object(members) if members.is_empty() => out.push_str("{}"),
        Node::Array(items) => {
            out.push_str("[\n");
            for (index, item) in items.iter().enumerate() {
                write_indent(depth + 1, out);
                write_pretty(item, depth + 1, out);
                out.push_str(if index + 1 < items.len() { ",\n" } else { "\n" });
            }
            write_indent(depth, out);
            out.push(']');
        }
        Node::Object(members) => {
            out.push_str("{\n");
            for (index, member) in members.iter().enumerate() {
                write_indent(depth + 1, out);
                out.push_str(member.key);
                out.push_str(": ");
                write_pretty(&member.value, depth + 1, out);
                out.push_str(if index + 1 < members.len() { ",\n" } else { "\n" });
            }
            write_indent(depth, out);
            out.push('}');
        }
    }
}

fn write_minified(node: &Node<'_>, out: &mut String) {
    match node {
        Node::Scalar(lexeme) => out.push_str(lexeme),
        Node::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_minified(item, out);
            }
            out.push(']');
        }
        Node::Object(members) => {
            out.push('{');
            for (index, member) in members.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(member.key);
                out.push(':');
                write_minified(&member.value, out);
            }
            out.push('}');
        }
    }
}

fn collect_duplicates(
    node: &Node<'_>,
    text: &str,
    path: &mut String,
    found: &mut Vec<DuplicateKey>,
) {
    match node {
        Node::Scalar(_) => {}
        Node::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                let restore = path.len();
                path.push_str(&format!("[{index}]"));
                collect_duplicates(item, text, path, found);
                path.truncate(restore);
            }
        }
        Node::Object(members) => {
            let mut seen = HashSet::new();
            for member in members {
                let key = decode_key(member.key);
                let restore = path.len();
                path.push('.');
                path.push_str(&key);
                if !seen.insert(key) {
                    let (line, column) = position(text, member.key_offset);
                    found.push(DuplicateKey {
                        path: path.clone(),
                        line,
                        column,
                    });
                }
                collect_duplicates(&member.value, text, path, found);
                path.truncate(restore);
            }
        }
    }
}

/// The text a key lexeme denotes, so `"a"` and `"a"` compare equal. The
/// lexeme was validated by the parser. A lone surrogate has no `char`, so it
/// is kept as its escape text, which keeps distinct keys distinct.
fn decode_key(lexeme: &str) -> String {
    let inner: Vec<char> = lexeme
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(lexeme)
        .chars()
        .collect();
    let hex4 = |at: usize| -> Option<u32> {
        let digits = inner.get(at..at + 4)?;
        digits
            .iter()
            .try_fold(0u32, |acc, c| Some(acc * 16 + c.to_digit(16)?))
    };
    let mut out = String::with_capacity(inner.len());
    let mut i = 0;
    while i < inner.len() {
        let c = inner[i];
        i += 1;
        if c != '\\' {
            out.push(c);
            continue;
        }
        let Some(&escape) = inner.get(i) else { break };
        i += 1;
        match escape {
            'b' => out.push('\u{8}'),
            'f' => out.push('\u{c}'),
            'n' => out.push('\n'),
            'r' => out.push('\r'),
            't' => out.push('\t'),
            'u' => {
                let Some(unit) = hex4(i) else { break };
                i += 4;
                let is_high = (0xD800..0xDC00).contains(&unit);
                let low = if is_high && inner.get(i) == Some(&'\\') && inner.get(i + 1) == Some(&'u')
                {
                    hex4(i + 2).filter(|low| (0xDC00..0xE000).contains(low))
                } else {
                    None
                };
                match (low, char::from_u32(unit)) {
                    (Some(low), _) => {
                        i += 6;
                        let scalar = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00);
                        out.push(char::from_u32(scalar).unwrap_or('\u{FFFD}'));
                    }
                    (None, Some(scalar)) => out.push(scalar),
                    (None, None) => out.push_str(&format!("\\u{unit:04x}")),
                }
            }
            // `"`, `\` and `/` stand for themselves.
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(text: &str) -> String {
        pretty(text).expect("valid json")
    }

    fn m(text: &str) -> String {
        minify(text).expect("valid json")
    }

    // --- pretty ---

    #[test]
    fn pretty_indents_nested_values_with_two_spaces_and_ends_with_a_newline() {
        let expected = "{\n  \"a\": {\n    \"y\": [\n      {\n        \"c\": 2,\n        \"d\": 1\n      }\n    ],\n    \"z\": true\n  },\n  \"b\": null\n}\n";
        assert_eq!(p(r#"{"a":{"y":[{"c":2,"d":1}],"z":true},"b":null}"#), expected);
    }

    #[test]
    fn pretty_keeps_object_keys_in_their_original_order() {
        assert_eq!(
            p(r#"{"z":1,"a":2,"m":{"y":1,"b":2}}"#),
            "{\n  \"z\": 1,\n  \"a\": 2,\n  \"m\": {\n    \"y\": 1,\n    \"b\": 2\n  }\n}\n"
        );
    }

    #[test]
    fn pretty_keeps_array_element_order() {
        assert_eq!(p("[3,1,2]"), "[\n  3,\n  1,\n  2\n]\n");
    }

    #[test]
    fn pretty_copies_every_number_lexeme_verbatim() {
        let numbers = [
            "1.50",
            "1e3",
            "-0",
            "12345678901234567890",
            "1E+2",
            "0.0",
            "-0.000",
            "6.02e-23",
            "9007199254740993",
        ];
        let input = format!("[{}]", numbers.join(","));
        let pretty_text = p(&input);
        for number in numbers {
            assert!(
                pretty_text.contains(&format!("  {number}")),
                "{number} must survive: {pretty_text}"
            );
        }
        assert_eq!(m(&pretty_text), input);
    }

    #[test]
    fn pretty_copies_string_escapes_verbatim() {
        let input = r#"{"a":"\u00e9","b":"\"","c":"\\/\n\t","d":"\ud83d\ude00","e":"\/"}"#;
        let text = p(input);
        for lexeme in [
            r#""\u00e9""#,
            r#""\"""#,
            r#""\\/\n\t""#,
            r#""\ud83d\ude00""#,
            r#""\/""#,
        ] {
            assert!(text.contains(lexeme), "{lexeme} must survive: {text}");
        }
    }

    #[test]
    fn pretty_keeps_raw_non_ascii_text_and_whitespace_inside_strings() {
        let text = p(r#"{"ñandú":"  spaced   é 名前  "}"#);
        assert_eq!(text, "{\n  \"ñandú\": \"  spaced   é 名前  \"\n}\n");
    }

    #[test]
    fn pretty_prints_empty_containers_compactly() {
        assert_eq!(p("{}"), "{}\n");
        assert_eq!(p("[]"), "[]\n");
        assert_eq!(p(r#"{"a":{},"b":[]}"#), "{\n  \"a\": {},\n  \"b\": []\n}\n");
        assert_eq!(p("{ \n }"), "{}\n");
    }

    #[test]
    fn pretty_accepts_surrounding_and_inner_whitespace_of_every_kind() {
        assert_eq!(p(" \t\r\n{ \"a\" :\r\n 1 }\n\n"), "{\n  \"a\": 1\n}\n");
    }

    #[test]
    fn pretty_is_idempotent() {
        let once = p(r#"{"b":[1.50,{"y":1e3,"x":-0}],"a":null}"#);
        assert_eq!(p(&once), once);
    }

    #[test]
    fn pretty_accepts_scalars_at_the_top_level() {
        assert_eq!(p(" 1.50 "), "1.50\n");
        assert_eq!(p("\"x\""), "\"x\"\n");
        assert_eq!(p("true"), "true\n");
        assert_eq!(p("null"), "null\n");
    }

    // --- minify ---

    #[test]
    fn minify_strips_insignificant_whitespace_only() {
        let messy = "{\n  \"a\" : [ 1 , 2.50 , { \"b\" : \"x  y\" } ] ,\r\n  \"c\" : { } \n}\n";
        assert_eq!(m(messy), r#"{"a":[1,2.50,{"b":"x  y"}],"c":{}}"#);
    }

    #[test]
    fn minify_keeps_whitespace_inside_strings() {
        assert_eq!(m(r#"[ " a  b\t " ]"#), r#"[" a  b\t "]"#);
    }

    #[test]
    fn minify_of_pretty_equals_minify_of_the_original() {
        for input in [
            r#"{"b":1.50,"a":{"z":[1e3,-0,{"q":"\u00e9"}],"y":{}}}"#,
            "{ \"b\" : 1 ,\n \"a\" : [ ] }",
            "[ 12345678901234567890 , \"\\\"\" , null ]",
            r#"{"a":1,"a":2}"#,
        ] {
            assert_eq!(m(&p(input)), m(input), "{input}");
        }
    }

    #[test]
    fn minify_of_pretty_reproduces_an_already_minified_value_byte_for_byte() {
        for input in [
            r#"{"b":1.50,"a":{"z":[1e3,-0,{"q":"\u00e9","r":"\/"}],"y":{}},"n":12345678901234567890}"#,
            r#"[1,2,[3,[4,[]]],{}]"#,
            r#"{"dup":1,"dup":2}"#,
            r#"{"ñandú":"名前"}"#,
        ] {
            assert_eq!(m(&p(input)), input);
        }
    }

    // --- rejection ---

    #[test]
    fn invalid_json_is_rejected() {
        let invalid = [
            "",
            "   ",
            "{",
            "}",
            "[",
            "{\"a\"}",
            "{\"a\":}",
            "{\"a\":1,}",
            "{,\"a\":1}",
            "[1,]",
            "[,1]",
            "[1 2]",
            "{\"a\" 1}",
            "{'a':1}",
            "{a:1}",
            "01",
            "1.",
            ".5",
            "+1",
            "-",
            "1e",
            "1e+",
            "NaN",
            "Infinity",
            "nul",
            "tru",
            "truex",
            "\"abc",
            "\"a\nb\"",
            "\"a\tb\"",
            "\"\\x\"",
            "\"\\u12\"",
            "\"\\u12G4\"",
            "{\"a\":1} x",
            "{\"a\":1}{\"b\":2}",
            "[1] [2]",
            "\u{feff}{\"a\":1}",
            "// c\n{}",
        ];
        for text in invalid {
            assert!(pretty(text).is_err(), "pretty should reject {text:?}");
            assert!(minify(text).is_err(), "minify should reject {text:?}");
            assert!(duplicate_keys(text).is_err(), "duplicates should reject {text:?}");
        }
    }

    #[test]
    fn an_error_reports_the_line_and_column_of_the_offending_character() {
        let error = pretty("{\n  \"a\": ,\n}").unwrap_err();
        assert_eq!((error.line, error.column), (2, 8));
        let error = pretty("[1,\n2,\n  x]").unwrap_err();
        assert_eq!((error.line, error.column), (3, 3));
        let error = pretty("{\"a\":1} extra").unwrap_err();
        assert_eq!((error.line, error.column), (1, 9));
    }

    #[test]
    fn an_error_column_counts_characters_not_bytes() {
        let error = pretty("[\"ñandú\", x]").unwrap_err();
        assert_eq!((error.line, error.column), (1, 11));
    }

    #[test]
    fn an_error_never_echoes_any_of_the_input() {
        let hostile = [
            r#"{"super-secret-token": tru}"#,
            r#"{"k": "hunter2-super-secret" "x"}"#,
            "\"hunter2-super-secret",
            "{\"hunter2-super-secret\"}",
        ];
        for text in hostile {
            let error = pretty(text).unwrap_err();
            let shown = format!("{error} / {error:?}");
            assert!(!shown.contains("secret"), "{shown}");
            assert!(!shown.contains("hunter2"), "{shown}");
            assert!(shown.contains("line"), "{shown}");
        }
    }

    #[test]
    fn nesting_up_to_the_depth_limit_is_accepted_and_deeper_is_rejected() {
        let nested = |depth: usize| format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        assert!(pretty(&nested(MAX_DEPTH)).is_ok());
        assert!(minify(&nested(MAX_DEPTH)).is_ok());
        assert!(pretty(&nested(MAX_DEPTH + 1)).is_err());
        assert!(minify(&nested(MAX_DEPTH + 1)).is_err());
        assert!(pretty(&nested(100_000)).is_err(), "must not overflow the stack");
    }

    // --- is_container ---

    #[test]
    fn is_container_accepts_valid_objects_and_arrays_only() {
        for text in ["{}", "[]", " \n{\"a\":1}\n", "[1,2,{\"b\":[]}]", "{\"a\":1,\"a\":2}"] {
            assert!(is_container(text), "{text:?}");
        }
        for text in ["", "123", "true", "null", "\"x\"", "plain", "{broken", "[1,]", "{} x"] {
            assert!(!is_container(text), "{text:?}");
        }
    }

    // --- duplicate keys ---

    #[test]
    fn duplicate_keys_is_empty_when_every_key_is_unique() {
        assert_eq!(duplicate_keys(r#"{"a":1,"b":{"a":2},"c":[{"a":3},{"a":4}]}"#).unwrap(), vec![]);
        assert_eq!(duplicate_keys("[]").unwrap(), vec![]);
        assert_eq!(duplicate_keys("42").unwrap(), vec![]);
    }

    #[test]
    fn duplicate_keys_reports_the_path_and_position_of_the_repeated_key() {
        let found = duplicate_keys("{\"a\":1,\n\"b\":2,\n  \"a\":3}").unwrap();
        assert_eq!(
            found,
            vec![DuplicateKey {
                path: "$.a".into(),
                line: 3,
                column: 3
            }]
        );
    }

    #[test]
    fn duplicate_keys_finds_repeats_in_nested_objects_and_arrays() {
        let found = duplicate_keys(r#"{"x":{"k":1,"k":2},"l":[0,{"m":1,"m":2}]}"#).unwrap();
        let paths: Vec<&str> = found.iter().map(|d| d.path.as_str()).collect();
        assert_eq!(paths, vec!["$.x.k", "$.l[1].m"]);
    }

    #[test]
    fn duplicate_keys_treats_an_escaped_spelling_as_the_same_key() {
        let found = duplicate_keys(r#"{"a":1,"\u0061":2,"\ud83d\ude00":1,"😀":2}"#).unwrap();
        let paths: Vec<&str> = found.iter().map(|d| d.path.as_str()).collect();
        assert_eq!(paths, vec!["$.a", "$.😀"]);
    }

    #[test]
    fn duplicate_keys_reports_each_extra_occurrence() {
        let found = duplicate_keys(r#"{"a":1,"a":2,"a":3}"#).unwrap();
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn duplicate_keys_does_not_confuse_distinct_lone_surrogate_keys() {
        let found = duplicate_keys(r#"{"\ud800":1,"\ud801":2}"#).unwrap();
        assert_eq!(found, vec![]);
    }

    #[test]
    fn formatting_a_value_with_duplicate_keys_keeps_every_member_in_order() {
        assert_eq!(m(r#"{"a":1,"b":2,"a":3}"#), r#"{"a":1,"b":2,"a":3}"#);
        assert_eq!(p(r#"{"a":1,"a":2}"#), "{\n  \"a\": 1,\n  \"a\": 2\n}\n");
    }
}
