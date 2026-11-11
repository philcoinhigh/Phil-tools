# Phil extension error codes

These codes are defined by the Phil VS Code extension. The upstream Phil toolchain does not yet publish stable diagnostic codes; the extension's syntax checker follows `grammar/phase1-surface.ebnf` (Grammar v1). Passing these checks means the file is syntactically valid, not that the Phil checker accepts its ownership, typing, authority or proof obligations.

| Code | Meaning |
| --- | --- |
| [PHIL-L001](#phil-l001) | Unterminated string literal |
| [PHIL-L002](#phil-l002) | Invalid escape sequence |
| [PHIL-L003](#phil-l003) | Invalid Unicode escape |
| [PHIL-L004](#phil-l004) | Invalid character literal |
| [PHIL-L005](#phil-l005) | Unexpected character |
| [PHIL-L006](#phil-l006) | Malformed number |
| [PHIL-P001](#phil-p001) | Syntax error |
| [PHIL-P002](#phil-p002) | Unclosed delimiter |
| [PHIL-P003](#phil-p003) | Unmatched closing delimiter |
| [PHIL-P005](#phil-p005) | Reserved word used as a name |
| [PHIL-P006](#phil-p006) | Construct from another language |
| [PHIL-P007](#phil-p007) | Missing semicolon |
| [PHIL-P008](#phil-p008) | Assignment is not supported |
| [PHIL-P009](#phil-p009) | Unexpected end of file |
| [PHIL-S001](#phil-s001) | Duplicate top-level name (warning) |
| [PHIL-S002](#phil-s002) | Duplicate field, variant, parameter, arm or branch |
| [PHIL-I001](#phil-i001) | Legacy Phase 0 syntax |
| [PHIL-C001](#phil-c001) | philc rejected the file |

## PHIL-L001

**Unterminated string literal**

A string literal must close with `"` on the same line. Raw newlines and carriage returns are not allowed inside strings; write `\n` instead.

Rejected:

```phil
let s = "hello
world";
```

Accepted:

```phil
let s = "hello\nworld";
```

## PHIL-L002

**Invalid escape sequence**

Inside string and character literals Phil accepts only `\"` (or `\'` in chars), `\\`, `\n`, `\r`, `\t` and `\u{hex}`.

Rejected:

```phil
let s = "tab\q";
```

Accepted:

```phil
let s = "tab\t";
```

## PHIL-L003

**Invalid Unicode escape**

`\u{...}` must contain one to six hex digits naming a Unicode scalar value: at most 10FFFF and not a surrogate (D800–DFFF).

Rejected:

```phil
let c = '\u{D800}';
```

Accepted:

```phil
let c = '\u{1F600}';
```

## PHIL-L004

**Invalid character literal**

A `Char` literal must contain exactly one Unicode scalar between single quotes. Use double quotes for a `String`.

Rejected:

```phil
let c = 'ab';
```

Accepted:

```phil
let s = "ab";
```

## PHIL-L005

**Unexpected character**

The character cannot start any Phil token. Common causes: `!` (use `not`), `&&`/`||` (use `and`/`or`), `#` comments (use `//`), `?`.

Rejected:

```phil
requires !done && ready;
```

Accepted:

```phil
requires not done and ready;
```

## PHIL-L006

**Malformed number**

Numeric literals are plain decimal (`42`, `1.5`) and may not run into letters. Phil has no hex/binary literals or type suffixes; use `convert e to T` for width changes.

Rejected:

```phil
let x = 0xFF;
```

Accepted:

```phil
let x = 255;
```

## PHIL-P001

**Syntax error**

The parser expected one of the listed tokens or constructs. The location is the furthest point any grammar alternative reached, which is usually where the mistake is. Where a near-miss keyword is found, a 'Did you mean' quick fix is offered.

## PHIL-P002

**Unclosed delimiter**

A `(`, `[` or `{` has no matching closer. The related location shows where the parser found a different closer.

## PHIL-P003

**Unmatched closing delimiter**

A `)`, `]` or `}` appears with no corresponding opener.

## PHIL-P005

**Reserved word used as a name**

Phil reserves 138 words (see the keyword hovers). They cannot be used as identifiers. Note that modes such as `linear` are properties of types, never of bindings.

Rejected:

```phil
let linear x = payload;
```

Accepted:

```phil
let x = payload;
```

## PHIL-P006

**Construct from another language**

The word is common in other languages but has no meaning in Phil. The message explains the Phil way to express the same intent.

Rejected:

```phil
unsafe { 0 }
```

Accepted:

```phil
// state the assumption explicitly instead
```

## PHIL-P007

**Missing semicolon**

Grammar v1 terminates every statement and static declaration item with `;`, including expression statements that end in a block such as `match`, `offer` or `loop`. A quick fix inserts it.

Rejected:

```phil
return unit
}
```

Accepted:

```phil
return unit;
}
```

## PHIL-P008

**Assignment is not supported**

Phil bindings are immutable. Introduce a new binding with `let`, or carry changing state through `loop state (...)` and `continue (...)`.

Rejected:

```phil
x = 1;
```

Accepted:

```phil
let x = 1;
```

## PHIL-P009

**Unexpected end of file**

The file ended in the middle of a construct, usually because of a missing `}` or `;`.

## PHIL-S001

**Duplicate top-level name (warning)**

Two top-level declarations in the same file share a name. This is reported as a warning because the extension does not model Phil's name resolution; the checker has the final word.

## PHIL-S002

**Duplicate field, variant, parameter, arm or branch**

A record field, sum variant, term parameter, match/offer/decide arm, or protocol select/offer branch label appears twice in the same list. The upstream checker rejects duplicate offer arms (see test/fixtures/fsem02-source-offer-v1/duplicate-arm.phil).

Rejected:

```phil
offer endpoint {
  Go => { return unit; }
  Go => { return unit; }
};
```

## PHIL-I001

**Legacy Phase 0 syntax**

The file is not valid Grammar v1 and contains no `;` terminators, so it is treated as the frozen Phase 0 surface syntax that `philc` and the repository's `examples/` still use. Only lexical and bracket checks run on it.

## PHIL-C001

**philc rejected the file**

Reported by the 'Phil: Emit LLVM IR with philc' command. The current public compiler only lowers a tiny runnable fragment: a single `component main` with no parameters that provides `Unit` (body exactly `return unit`) or `U32` (only `let` bindings and a final `return` of integer literals).

