import { OTC_SOURCE } from "./otc-source";

// Playground examples. Each one is also a test: `expect` is the outcome the simulator must produce.

export interface Example {
  id: string;
  title: string;
  group: "Basics" | "Protocols" | "Tokens" | "From the Phil repository" | "Caught by Phil";
  blurb: string;
  inputs?: Record<string, string>;
  expect: "ok" | "linearity" | "contract" | "protocol" | "arithmetic" | "deadlock" | "limit";
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "hello",
    title: "Hello, Phil",
    group: "Basics",
    blurb: "A single component with checked fixed-width arithmetic.",
    expect: "ok",
    code: `// A component is an executable part of a Phil system.
// \`provides U32\` says what it hands back when it finishes.
component main provides U32 {
  let x = convert 40 to U32;   // integer widths are always explicit
  let answer = x + 2;
  console_write("The answer is", answer);
  return answer;
}
`,
  },
  {
    id: "loop",
    title: "Loop with an invariant",
    group: "Basics",
    blurb: "Loop state is passed forward explicitly; the invariant is checked on every entry.",
    inputs: { n: "5" },
    expect: "ok",
    code: `// Sum 1..n. A Phil loop has no mutable variables: \`continue (...)\`
// supplies the next state, and \`break (...)\` supplies the result.
// \`n : {v : U32 | v > 0}\` is a refinement type: a U32 that is greater than zero.

component main(n : {v : U32 | v > 0}) provides U32 {
  let total = loop state (i : U32 = n, acc : U32 = 0) invariant i > 0 {
    // gt(a, b) is a simulator host operation: ordinary Phil expressions
    // have no comparison operators (comparisons live in propositions).
    if gt(i, 1) {
      continue (i - 1, acc + i);
    } else {
      break (acc + i);
    };
  };
  console_write("sum =", total);
  return total;
}
`,
  },
  {
    id: "contract",
    title: "Function contracts",
    group: "Basics",
    blurb: "A callable contract with requires/ensures, checked on every call.",
    inputs: { amount: "30", fee: "5" },
    expect: "ok",
    code: `// \`callable\` declares a public contract. \`fn ... satisfies\` implements it.
// The simulator checks \`requires\` before each call and \`ensures\` after it.
// (Real Phil discharges these statically; try fee > amount to see a violation.)

callable Deduct(amount : U64, fee : U64) -> U64 {
  requires fee <= amount;
  ensures fee <= amount;
  outcomes { success U64 };
}

fn deduct(amount : U64, fee : U64) -> U64 satisfies Deduct {
  return amount - fee;
}

component main(amount : U64, fee : U64) provides U64 {
  let net = deduct(amount, fee);
  console_write("net =", net);
  return net;
}
`,
  },
  {
    id: "ping",
    title: "Ping (from the Phil tour)",
    group: "Protocols",
    blurb: "Two processes, one protocol, one message. The exact program from section 18 of the tour.",
    inputs: { payload: "42" },
    expect: "ok",
    code: `// The complete one-shot Ping from "A Tour of Phil", section 18.
protocol Ping {
  role Client = send (x : U8) then end Done;
  role Server = receive (x : U8) then end Done;
}

component ClientWorker(endpoint : Client[Ping], payload : U8) {
  // send consumes the endpoint and returns its successor
  let done = send payload on endpoint;
  close done;
}

component ServerWorker(endpoint : Server[Ping]) {
  let (done, received) = receive U8 on endpoint;
  console_write("server received", received);
  close done;
}

architecture LocalPing {
  instance client = ClientWorker;
  instance server = ServerWorker;
  process client_run = client;
  process server_run = server;
  protocol ping = Ping;
  role ping.Client = client;
  role ping.Server = server;
  entry payload : U8;
  bind client.endpoint = ping.Client;
  bind client.payload = payload;
  bind server.endpoint = ping.Server;
}

program main = instantiate LocalPing;
`,
  },
  {
    id: "pingpong",
    title: "Ping-pong rounds",
    group: "Protocols",
    blurb: "A recursive protocol with a choice: the client selects Ping or Done, the server offers both.",
    inputs: { rounds: "3" },
    expect: "ok",
    code: `// A recursive protocol. Each round the client chooses Ping (and a
// request/reply follows) or Done (and the session ends).
protocol PingLoop {
  role Client = recursive Loop = select {
    Ping => send (x : U32) then receive (reply : String) then continue Loop |
    Done => end Done
  };
  role Server = recursive Loop = offer {
    Ping => receive (x : U32) then send (reply : String) then continue Loop |
    Done => end Done
  };
}

component Client(endpoint : Client[PingLoop], rounds : U32) {
  loop state (ep = endpoint, remaining : U32 = rounds) {
    if eq(remaining, 0) {
      let finished = select Done on ep;
      close finished;
      break;
    } else {
      let chosen = select Ping on ep;
      let awaiting = send remaining on chosen;
      let (next, reply) = receive String on awaiting;
      console_write("client got", reply);
      continue (next, remaining - 1);
    };
  };
}

component Server(endpoint : Server[PingLoop]) provides U32 {
  let served = loop state (ep = endpoint, count : U32 = 0) {
    // Inside an offer arm, \`ep\` names the endpoint's next state.
    offer ep {
      Ping => {
        let (replyTo, x) = receive U32 on ep;
        let next = send "pong" on replyTo;
        continue (next, count + 1);
      }
      Done => {
        close ep;
        break (count);
      }
    };
  };
  return served;
}

architecture Rounds {
  instance client = Client;
  instance server = Server;
  process client_run = client;
  process server_run = server;
  protocol ping = PingLoop;
  role ping.Client = client;
  role ping.Server = server;
  entry rounds : U32;
  bind client.endpoint = ping.Client;
  bind client.rounds = rounds;
  bind server.endpoint = ping.Server;
}

program main = instantiate Rounds;
`,
  },
  {
    id: "token",
    title: "Linear token payment",
    group: "Tokens",
    blurb: "Coins are linear: they can be split, sent and merged, but never copied or lost.",
    inputs: { balance: "100", price: "30", savings: "500" },
    expect: "ok",
    code: `// A coin is a *linear* value: Phil guarantees it is used exactly once.
// It can be split, merged or sent to another process, but it can
// never be duplicated (no double-spend) or silently dropped (no burn by accident).
record Coin mode linear {
  amount : U64
}

callable Split(coin : Coin, part : U64) -> (Coin, Coin) {
  requires part <= coin.amount;   // checked on every call
  outcomes { success (Coin, Coin) };
}

fn split(coin : Coin, part : U64) -> (Coin, Coin) satisfies Split {
  let Coin { amount = total } = coin;   // destructuring consumes the coin
  return (construct Coin { amount = part }, construct Coin { amount = total - part });
}

callable Merge(a : Coin, b : Coin) -> Coin {
  outcomes { success Coin };
}

fn merge(a : Coin, b : Coin) -> Coin satisfies Merge {
  let Coin { amount = x } = a;
  let Coin { amount = y } = b;
  return construct Coin { amount = x + y };   // U64 addition never wraps
}

// The payment conversation: a coin goes one way, a receipt comes back.
protocol Payment {
  role Payer = send (coin : Coin) then receive (receipt : U64) then end Paid;
  role Payee = receive (coin : Coin) then send (receipt : U64) then end Paid;
}

component Alice(channel : Payer[Payment], balance : U64, price : U64) provides Coin {
  let wallet = construct Coin { amount = balance };
  let (payment, change) = split(wallet, price);
  let awaiting = send payment on channel;     // the coin moves to Bob
  let (done, receipt) = receive U64 on awaiting;
  close done;
  let kept = borrow change as c { return c.amount; };
  console_write("Alice got a receipt for", receipt, "and keeps", kept);
  return change;
}

component Bob(channel : Payee[Payment], savings : U64) provides Coin {
  let (replyTo, coin) = receive Coin on channel;
  let paid = borrow coin as c { return c.amount; };
  let done = send paid on replyTo;
  close done;
  return merge(construct Coin { amount = savings }, coin);
}

architecture Shop {
  instance alice = Alice;
  instance bob = Bob;
  process alice_run = alice;
  process bob_run = bob;
  protocol pay = Payment;
  role pay.Payer = alice;
  role pay.Payee = bob;
  entry balance : U64;
  entry price : U64;
  entry savings : U64;
  bind alice.channel = pay.Payer;
  bind alice.balance = balance;
  bind alice.price = price;
  bind bob.channel = pay.Payee;
  bind bob.savings = savings;
}

program main = instantiate Shop;
`,
  },
  {
    id: "otc",
    title: "OTC desk (escrow swap)",
    group: "Tokens",
    blurb: "Three programs: a maker lists tokens with a desk and a taker fills the listing in parts, until it sells out, expires or is cancelled. Every coin ends with exactly one owner.",
    inputs: { selling: "1000", unit_price: "2", want: "400", wallet: "5000", fee_bps: "100", expires_after: "10", cancel_after: "0" },
    expect: "ok",
    code: OTC_SOURCE,
  },
  {
    id: "repo-stage2",
    title: "Ping stage 2: request and reply",
    group: "From the Phil repository",
    blurb: "Phil's own second Ping stage: a request goes out and a reply comes back.",
    inputs: { payload: "42" },
    expect: "ok",
    code: `// handoff/phase1/ping/stage2-request-reply.phil from the Phil repository, unmodified (Apache-2.0).
protocol PingRoundTrip {
  role Client = send (x : U8) then receive (reply : String) then end Done;
  role Server = receive (x : U8) then send (reply : String) then end Done;
}
component ClientWorker(endpoint : Client[PingRoundTrip], payload : U8) {
  let awaiting = send payload on endpoint;
  let (done, reply) = receive String on awaiting;
  let writeDecision = console_write(reply);
  close done;
}
component ServerWorker(endpoint : Server[PingRoundTrip]) {
  let (replyEndpoint, request) = receive U8 on endpoint;
  let done = send "pong" on replyEndpoint;
  close done;
}
architecture RoundTrip {
  instance client = ClientWorker;
  instance server = ServerWorker;
  process client_run = client;
  process server_run = server;
  protocol ping = PingRoundTrip;
  role ping.Client = client;
  role ping.Server = server;
  entry payload : U8;
  bind client.endpoint = ping.Client;
  bind client.payload = payload;
  bind server.endpoint = ping.Server;
}
program main = instantiate RoundTrip;
`,
  },
  {
    id: "repo-stage4",
    title: "Ping stage 4: unbounded",
    group: "From the Phil repository",
    blurb: "Phil's own endless Ping. The server receives directly on an endpoint that is waiting for the client's choice. It never finishes, so the simulator stops it.",
    
    expect: "limit",
    code: `// handoff/phase1/ping/stage4-unbounded.phil from the Phil repository, unmodified (Apache-2.0).
protocol PingLoop {
  role Client = recursive Loop = select {
    Ping => send (x : U8) then receive (reply : String) then continue Loop |
    Done => end Done
  };
  role Server = recursive Loop = offer {
    Ping => receive (x : U8) then send (reply : String) then continue Loop |
    Done => end Done
  };
}
component ClientLoop(endpoint : Client[PingLoop]) {
  loop state (currentEndpoint = endpoint) {
    let selected = select Ping on currentEndpoint;
    let awaiting = send 42 on selected;
    let (nextEndpoint, reply) = receive String on awaiting;
    let writeDecision = console_write(reply);
    continue (nextEndpoint);
  };
}
component ServerLoop(endpoint : Server[PingLoop]) {
  loop state (currentEndpoint = endpoint) {
    let (replyEndpoint, request) = receive U8 on currentEndpoint;
    let nextEndpoint = send "pong" on replyEndpoint;
    continue (nextEndpoint);
  };
}
architecture BarePing {
  instance client = ClientLoop;
  instance server = ServerLoop;
  process client_run = client;
  process server_run = server;
  protocol ping = PingLoop;
  role ping.Client = client;
  role ping.Server = server;
  bind client.endpoint = ping.Client;
  bind server.endpoint = ping.Server;
}
program main = instantiate BarePing;
`,
  },
  {
    id: "doublespend",
    title: "Double spend",
    group: "Caught by Phil",
    blurb: "Spending the same linear coin twice is rejected.",
    expect: "linearity",
    code: `record Coin mode linear {
  amount : U64
}

callable Spend(coin : Coin) -> U64 {
  outcomes { success U64 };
}

fn spend(coin : Coin) -> U64 satisfies Spend {
  let Coin { amount } = coin;
  return amount;
}

component main provides U64 {
  let coin = construct Coin { amount = 10 };
  let first = spend(coin);
  let second = spend(coin);   // the same coin, again
  return first + second;
}
`,
  },
  {
    id: "lostcoin",
    title: "Lost coin",
    group: "Caught by Phil",
    blurb: "A linear value that is never used is an error, not a silent leak.",
    expect: "linearity",
    code: `record Coin mode linear {
  amount : U64
}

component main provides U64 {
  let coin = construct Coin { amount = 10 };
  // ...the coin is forgotten here
  return 0;
}
`,
  },
  {
    id: "overspend",
    title: "Overspend",
    group: "Caught by Phil",
    blurb: "Splitting off more than a coin holds violates the contract.",
    expect: "contract",
    code: `record Coin mode linear {
  amount : U64
}

callable Split(coin : Coin, part : U64) -> (Coin, Coin) {
  requires part <= coin.amount;
  outcomes { success (Coin, Coin) };
}

fn split(coin : Coin, part : U64) -> (Coin, Coin) satisfies Split {
  let Coin { amount = total } = coin;
  return (construct Coin { amount = part }, construct Coin { amount = total - part });
}

component main provides Coin {
  let wallet = construct Coin { amount = 20 };
  let (payment, change) = split(wallet, 50);   // only 20 available
  let Coin { amount = a } = payment;
  return change;
}
`,
  },
  {
    id: "overflow",
    title: "Arithmetic overflow",
    group: "Caught by Phil",
    blurb: "Fixed-width arithmetic traps instead of wrapping around.",
    expect: "arithmetic",
    code: `component main provides U8 {
  let x = convert 250 to U8;
  let y = x + 10;   // 260 does not fit in a U8
  return y;
}
`,
  },
  {
    id: "earlyclose",
    title: "Closing too early",
    group: "Caught by Phil",
    blurb: "An endpoint can only be closed once its protocol has reached `end`.",
    inputs: { payload: "7" },
    expect: "protocol",
    code: `protocol Ping {
  role Client = send (x : U8) then end Done;
  role Server = receive (x : U8) then end Done;
}

component ClientWorker(endpoint : Client[Ping], payload : U8) {
  close endpoint;   // the protocol says: send first
}

component ServerWorker(endpoint : Server[Ping]) {
  let (done, received) = receive U8 on endpoint;
  close done;
}

architecture LocalPing {
  instance client = ClientWorker;
  instance server = ServerWorker;
  process client_run = client;
  process server_run = server;
  protocol ping = Ping;
  role ping.Client = client;
  role ping.Server = server;
  entry payload : U8;
  bind client.endpoint = ping.Client;
  bind client.payload = payload;
  bind server.endpoint = ping.Server;
}

program main = instantiate LocalPing;
`,
  },
  {
    id: "reuse",
    title: "Reusing a consumed endpoint",
    group: "Caught by Phil",
    blurb: "Each protocol step consumes the endpoint; the old name cannot be used again.",
    expect: "linearity",
    code: `protocol TwoBytes {
  role Writer = send (a : U8) then send (b : U8) then end Done;
  role Reader = receive (a : U8) then receive (b : U8) then end Done;
}

component Writer(endpoint : Writer[TwoBytes]) {
  let next = send 1 on endpoint;
  let done = send 2 on endpoint;   // should be \`on next\`
  close done;
}

component Reader(endpoint : Reader[TwoBytes]) {
  let (e1, a) = receive U8 on endpoint;
  let (e2, b) = receive U8 on e1;
  close e2;
}

architecture Pair {
  instance w = Writer;
  instance r = Reader;
  process w_run = w;
  process r_run = r;
  protocol bytes = TwoBytes;
  role bytes.Writer = w;
  role bytes.Reader = r;
  bind w.endpoint = bytes.Writer;
  bind r.endpoint = bytes.Reader;
}

program main = instantiate Pair;
`,
  },
  {
    id: "deadlock",
    title: "Deadlock",
    group: "Caught by Phil",
    blurb: "Both sides wait to receive first. The simulator detects that nobody can move.",
    expect: "deadlock",
    code: `// Each role's protocol is fine on its own, but they are not complementary:
// both sides start by receiving, so neither can ever proceed.
protocol Stuck {
  role A = receive (x : U8) then send (y : U8) then end Done;
  role B = receive (x : U8) then send (y : U8) then end Done;
}

component Left(endpoint : A[Stuck]) {
  let (e1, x) = receive U8 on endpoint;
  let e2 = send x on e1;
  close e2;
}

component Right(endpoint : B[Stuck]) {
  let (e1, x) = receive U8 on endpoint;
  let e2 = send x on e1;
  close e2;
}

architecture Standoff {
  instance left = Left;
  instance right = Right;
  process left_run = left;
  process right_run = right;
  protocol s = Stuck;
  role s.A = left;
  role s.B = right;
  bind left.endpoint = s.A;
  bind right.endpoint = s.B;
}

program main = instantiate Standoff;
`,
  },
];
