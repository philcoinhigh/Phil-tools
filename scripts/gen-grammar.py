# Generates syntaxes/phil.tmLanguage.json. Every Grammar-v1 reserved word must be
# assigned to exactly one category; the script fails otherwise.
import json, sys
reserved = json.load(open("src/reserved.json"))
I = r"[\p{L}_][\p{L}\p{N}_']*"
cats = {
  "keyword.control.phil": "if else match decide loop continue break return fail reject",
  "storage.type.declaration.phil": "record data type claim callable fn component protocol provider implementation opaque capability boundary architecture program module import recursive",
  "storage.modifier.mode.phil": "unrestricted affine linear mode",
  "keyword.operator.word.phil": "and or not in disjoint",
  "keyword.other.session.phil": "send receive select offer end close release send_exact receive_exact receive_frame commit_receive then using when on role",
  "keyword.other.term.phil": "let borrow consume construct accept convert transport validate recognize prove invoke closure captures as to from at with",
  "keyword.other.contract.phil": "requires ensures obligation assumes outcomes outcome success negative terminal fatal callee preserve replace effects authority cost law lifecycle operation permits satisfies provides structural proposition representation placement environment correspondence canonical failure invariant join state consumes borrows within",
  "keyword.other.architecture.phil": "instance ref process bind grant entry assume export observable constraint external originates instantiate",
  "support.type.primitive.phil": "Unit Bool Char String F32 F64 Bytes Frame Proof Validated",
  "storage.type.kind.phil": "Type Nat Session Message Effects",
  "constant.language.phil": "true false unit",
}
seen = {}
for scope, words in cats.items():
  for w in words.split():
    if w in seen: sys.exit(f"duplicate {w}")
    seen[w] = scope
missing = [w for w in reserved if w not in seen]
extra = [w for w in seen if w not in reserved]
if missing or extra: sys.exit(f"missing={missing} extra={extra}")

def kw(scope):
  words = sorted([w for w, s in seen.items() if s == scope], key=len, reverse=True)
  return {"match": r"(?<![\p{L}\p{N}_'])(?:" + "|".join(words) + r")(?![\p{L}\p{N}_'])", "name": scope}

B = r"(?<![\p{L}\p{N}_'])"   # identifier-aware word boundary (identifiers may contain ')
E = r"(?![\p{L}\p{N}_'])"
g = {
  "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  "name": "Phil",
  "scopeName": "source.phil",
  "fileTypes": ["phil"],
  "patterns": [{"include": "#comments"}, {"include": "#module"}, {"include": "#attribute"},
               {"include": "#declarations"}, {"include": "#architecture-items"}, {"include": "#literals"},
               {"include": "#types"}, {"include": "#keywords"}, {"include": "#arm-labels"}, {"include": "#calls"},
               {"include": "#identifiers"}, {"include": "#operators"}, {"include": "#punctuation"}, {"include": "#invalid"}],
  "repository": {
    "comments": {"patterns": [
      {"match": r"//\s*(TODO|FIXME|XXX|NOTE)\b.*$", "name": "comment.line.double-slash.phil", "captures": {"1": {"name": "keyword.todo.phil"}}},
      {"begin": "//", "end": "$", "name": "comment.line.double-slash.phil", "beginCaptures": {"0": {"name": "punctuation.definition.comment.phil"}}}]},
    "module": {"patterns": [
      {"match": B + r"(module|import)\s+(" + I + r"(?:\s*\.\s*" + I + r")*)",
       "captures": {"1": {"name": "storage.type.declaration.phil"}, "2": {"name": "entity.name.namespace.phil"}}}]},
    "attribute": {"patterns": [
      {"match": r"(@)\s*(" + I + ")", "captures": {"1": {"name": "punctuation.definition.annotation.phil"}, "2": {"name": "entity.name.function.decorator.phil"}}}]},
    "declarations": {"patterns": [
      {"match": B + r"((?:recursive\s+)?fn|component)\s+(" + I + ")",
       "captures": {"1": {"name": "storage.type.declaration.phil"}, "2": {"name": "entity.name.function.phil"}}},
      {"match": B + r"((?:opaque\s+)?provider\s+implementation)\s+(" + I + ")",
       "captures": {"1": {"name": "storage.type.declaration.phil"}, "2": {"name": "entity.name.type.implementation.phil"}}},
      {"match": B + r"(record|data|type|claim|callable|protocol|provider|capability|boundary|architecture)\s+(" + I + ")" + E,
       "captures": {"1": {"name": "storage.type.declaration.phil"}, "2": {"name": "entity.name.type.phil"}}},
      {"match": B + r"(program)\s+(" + I + r")\s*(=)\s*(instantiate)" + E,
       "captures": {"1": {"name": "storage.type.declaration.phil"}, "2": {"name": "entity.name.function.program.phil"},
                    "3": {"name": "keyword.operator.assignment.phil"}, "4": {"name": "keyword.other.architecture.phil"}}},
      {"match": B + r"(operation|law|lifecycle)\s+(" + I + r")(?=\s*(?::|=|satisfies" + E + "))",
       "captures": {"1": {"name": "keyword.other.contract.phil"}, "2": {"name": "entity.name.function.member.phil"}}},
      {"match": B + r"(role)\s+(" + I + r")(?=\s*=)",
       "captures": {"1": {"name": "keyword.other.session.phil"}, "2": {"name": "entity.name.type.role.phil"}}},
      {"match": B + r"(let)\s+(" + I + r")(?=\s*=)",
       "captures": {"1": {"name": "keyword.other.term.phil"}, "2": {"name": "variable.other.declaration.phil"}}},
      {"match": B + r"(as)\s+(" + I + r")(?=\s*\{)",
       "captures": {"1": {"name": "keyword.other.term.phil"}, "2": {"name": "variable.other.declaration.phil"}}}]},
    "architecture-items": {"patterns": [
      {"match": B + r"(instance|process|ref|entry)\s+(" + I + r")(?=\s*[=:])",
       "captures": {"1": {"name": "keyword.other.architecture.phil"}, "2": {"name": "variable.other.declaration.phil"}}}]},
    "literals": {"patterns": [
      {"begin": '"', "end": r'"|(?=$)', "name": "string.quoted.double.phil",
       "beginCaptures": {"0": {"name": "punctuation.definition.string.begin.phil"}},
       "endCaptures": {"0": {"name": "punctuation.definition.string.end.phil"}},
       "patterns": [{"include": "#escapes"}]},
      {"match": B + r"'(?:[^'\\\r\n]|\\(?:['\\nrt]|u\{[0-9a-fA-F]{1,6}\}))'", "name": "string.quoted.single.phil",
       "captures": {"0": {"patterns": [{"include": "#escapes"}]}}},
      {"match": r"(?<![\p{L}\p{N}_'.])\d+\.\d+" + E, "name": "constant.numeric.float.phil"},
      {"match": r"(?<![\p{L}\p{N}_'])\d+" + E, "name": "constant.numeric.integer.phil"},
      {"match": r"(?<![\p{L}\p{N}_'])\d[\p{L}\p{N}_'.]*", "name": "invalid.illegal.numeric.phil"}]},
    "escapes": {"patterns": [
      {"match": r"\\(?:[\"'\\nrt]|u\{[0-9a-fA-F]{1,6}\})", "name": "constant.character.escape.phil"},
      {"match": r"\\.?", "name": "invalid.illegal.escape.phil"}]},
    "types": {"patterns": [
      {"match": B + r"(?:U|I)\d+" + E, "name": "support.type.primitive.phil"},
      kw("support.type.primitive.phil"), kw("storage.type.kind.phil")]},
    "keywords": {"patterns": [kw(s) for s in cats if s not in ("support.type.primitive.phil", "storage.type.kind.phil")]},
    "arm-labels": {"patterns": [
      {"match": "(" + I + r"(?:\s*\.\s*" + I + r")*)(?=\s*(?:\([^()]*\)|\{[^{}]*\})?\s*=>)", "name": "entity.name.label.phil"}]},
    "calls": {"patterns": [
      {"match": "(" + I + r")(?=\s*\()", "name": "entity.name.function.call.phil"}]},
    "identifiers": {"patterns": [
      {"match": B + r"[\p{Lu}][\p{L}\p{N}_']*", "name": "entity.name.type.phil"},
      {"match": B + I, "name": "variable.other.phil"}]},
    "operators": {"patterns": [
      {"match": r"->|=>", "name": "keyword.operator.arrow.phil"},
      {"match": r"==|!=|<=|>=|<<|>>|<|>", "name": "keyword.operator.comparison.phil"},
      {"match": r"[+\-*/%]", "name": "keyword.operator.arithmetic.phil"},
      {"match": r"=", "name": "keyword.operator.assignment.phil"},
      {"match": r"\|", "name": "keyword.operator.pipe.phil"},
      {"match": r":", "name": "punctuation.separator.type.phil"}]},
    "punctuation": {"patterns": [
      {"match": ";", "name": "punctuation.terminator.phil"},
      {"match": ",", "name": "punctuation.separator.comma.phil"},
      {"match": r"\.", "name": "punctuation.accessor.phil"},
      {"match": r"[{}]", "name": "punctuation.section.braces.phil"},
      {"match": r"[()]", "name": "punctuation.section.parens.phil"},
      {"match": r"[\[\]]", "name": "punctuation.section.brackets.phil"}]},
    "invalid": {"patterns": [{"match": r"[^\s]", "name": "invalid.illegal.character.phil"}]},
  },
}
json.dump(g, open("syntaxes/phil.tmLanguage.json", "w"), indent=2, ensure_ascii=False)
print("ok", len(seen), "keywords")
