// A stand-in for philc, used only to test the browser runner: same command line,
// reads the file it is given, writes to stdout or stderr, and exits 0 or 1.
package main

import (
	"fmt"
	"os"
	"strings"
)

func main() {
	a := os.Args
	if len(a) != 5 || a[1] != "emit-llvm" || a[2] != "--target" {
		fmt.Fprintln(os.Stderr, "usage: philc emit-llvm --target TARGET FILE")
		os.Exit(1)
	}
	src, err := os.ReadFile(a[4])
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot read:", err)
		os.Exit(1)
	}
	if strings.Contains(string(src), "reject me") {
		fmt.Fprintf(os.Stderr, "%s:1:1: stand-in rejection\n", a[4])
		os.Exit(1)
	}
	fmt.Printf("; target %s\n; %d bytes of source\ndefine i32 @main() { ret i32 42 }\n", a[3], len(src))
}
