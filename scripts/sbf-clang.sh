#!/usr/bin/env bash
# Prints the path of Solana's SBF clang, installing Solana's platform tools first if needed.
# cargo-build-sbf asks GitHub's API which file to download, and shared CI runners are often
# refused by that API. When that happens the same file is fetched directly, with no API call.
find_clang() { find -L "$HOME/.cache/solana" "$HOME/.local/share/solana" -path '*llvm/bin/clang' -print -quit 2>/dev/null || true; }
CLANG="$(find_clang)"
if [ -z "$CLANG" ]; then cargo-build-sbf --install-only >&2 2>&1 || true; CLANG="$(find_clang)"; fi
if [ -z "$CLANG" ]; then
  V="$(cargo-build-sbf --version 2>/dev/null | grep -o 'platform-tools v[0-9.]*' | awk '{print $2}' || true)"
  if [ -n "$V" ]; then
    D="$HOME/.cache/solana/$V/platform-tools"
    for i in 1 2 3; do
      rm -rf "$D"; mkdir -p "$D"
      echo "fetching platform-tools $V directly (try $i)" >&2
      if curl -sSfL --retry 3 "https://github.com/anza-xyz/platform-tools/releases/download/$V/platform-tools-linux-x86_64.tar.bz2" | tar -xj -C "$D"; then break; fi
      sleep $((i * 15))
    done
    CLANG="$(find_clang)"
  fi
fi
[ -n "$CLANG" ] || { echo "No SBF clang found" >&2; exit 1; }
echo "$CLANG"
