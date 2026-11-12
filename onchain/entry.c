// The only code here that is not Phil. Solana calls `entrypoint`; it calls the function philc
// compiled from first.phil and writes what that returned to the transaction log.
//
// sol_log_ and sol_log_64_ are provided by Solana's virtual machine at load time.
typedef unsigned char uint8_t;
typedef unsigned int uint32_t;
typedef unsigned long uint64_t;

extern void sol_log_(const char *message, uint64_t length);
extern void sol_log_64_(uint64_t a, uint64_t b, uint64_t c, uint64_t d, uint64_t e);
extern uint32_t phil_main(void);

uint64_t entrypoint(const uint8_t *input) {
  uint32_t value = phil_main();
  sol_log_("Phil main returned:", 19);
  sol_log_64_(0, 0, 0, 0, value);
  return 0;
}
