/* A flat RISC-V image: everything in one block that starts at 0x1000, with _start first. */
ENTRY(_start)
SECTIONS
{
  . = 0x1000;
  .text : { *(.text.start) *(.text*) }
  .rodata : { *(.rodata*) *(.srodata*) }
  .data : { *(.data*) *(.sdata*) }
  __bss_start = .;
  .bss : { *(.bss*) *(.sbss*) *(COMMON) }
  __bss_end = .;
  /DISCARD/ : { *(.eh_frame*) *(.comment) *(.riscv.attributes) *(.note*) }
}
