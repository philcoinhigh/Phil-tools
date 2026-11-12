// The only code here that is not Phil: Solana calls `entrypoint`, which calls the function
// philc compiled from first.phil and writes what it returned to the transaction log.
#include <solana_sdk.h>

extern uint32_t phil_main(void);

extern uint64_t entrypoint(const uint8_t *input) {
  uint32_t value = phil_main();
  sol_log("Phil main returned:");
  sol_log_64(0, 0, 0, 0, value);
  return SUCCESS;
}
