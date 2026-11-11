// Learn Phil lessons. Every lesson is tested: the starter code must behave as `starts` says,
// and each solution must pass its own check (test/learn.ts).
import { OTC_SOURCE } from "../../core/src/sim/otc-source";

export interface Check { returns?: string; console?: string; messages?: number; hunt?: boolean }
export interface Lesson {
  id: string; chapter: string; title: string; text: string[]; task?: string;
  inputs?: Record<string, string>; code: string; solution?: string;
  starts: string; check?: Check;
}

export const LESSONS: Lesson[] = [
  {
    "id": "hello",
    "chapter": "Values",
    "title": "Your first program",
    "text": [
      "A Phil program is built from **components**. A component is a piece of code that runs and hands back a result. `provides U32` says the result is a `U32`: a whole number from 0 to about 4 billion.",
      "`let` gives a name to a value. Names never change once set. `convert 40 to U32` says exactly which kind of number you want, because Phil never guesses a number's size.",
      "Press **Run** to see what the program hands back."
    ],
    "task": "Change the program so it hands back 100.",
    "code": "component main provides U32 {\n  let x = convert 40 to U32;\n  let answer = x + 2;\n  console_write(\"The answer is\", answer);\n  return answer;\n}\n",
    "solution": "component main provides U32 {\n  let x = convert 40 to U32;\n  let answer = x + 60;\n  console_write(\"The answer is\", answer);\n  return answer;\n}\n",
    "starts": "ok",
    "check": {
      "returns": "100"
    }
  },
  {
    "id": "overflow",
    "chapter": "Values",
    "title": "Numbers never wrap around",
    "text": [
      "A `U8` holds 0 to 255. In many languages 250 + 10 in a byte quietly becomes 4. A lot of money has been lost to that kind of bug.",
      "Phil stops instead. Run this and read the error."
    ],
    "task": "Make the sum fit: use a bigger number type so the program hands back 260.",
    "code": "component main provides U8 {\n  let x = convert 250 to U8;\n  let y = x + 10;\n  return y;\n}\n",
    "solution": "component main provides U16 {\n  let x = convert 250 to U16;\n  let y = x + 10;\n  return y;\n}\n",
    "starts": "arithmetic",
    "check": {
      "returns": "260"
    }
  },
  {
    "id": "loop",
    "chapter": "Values",
    "title": "Loops without changing variables",
    "text": [
      "Phil has no variables that change. A loop carries its state forward by hand: `continue (...)` starts the next round with new values, and `break (...)` leaves the loop with a result.",
      "This loop adds the numbers from `n` down to 1. `gt(a, b)` means “a is greater than b”.",
      "The `invariant` is a rule that must hold at the start of every round. If it ever fails, the program stops."
    ],
    "task": "Change the loop to multiply instead of add, so that n = 5 gives 120.",
    "inputs": {
      "n": "5"
    },
    "code": "component main(n : {v : U32 | v > 0}) provides U32 {\n  let total = loop state (i : U32 = n, acc : U32 = 0) invariant i > 0 {\n    if gt(i, 1) {\n      continue (i - 1, acc + i);\n    } else {\n      break (acc + i);\n    };\n  };\n  return total;\n}\n",
    "solution": "component main(n : {v : U32 | v > 0}) provides U32 {\n  let total = loop state (i : U32 = n, acc : U32 = 1) invariant i > 0 {\n    if gt(i, 1) {\n      continue (i - 1, acc * i);\n    } else {\n      break (acc * i);\n    };\n  };\n  return total;\n}\n",
    "starts": "ok",
    "check": {
      "returns": "120"
    }
  },
  {
    "id": "contract",
    "chapter": "Values",
    "title": "Promises in the code",
    "text": [
      "A `callable` is a written promise about a function. `requires` is what the caller must guarantee. `ensures` is what the function guarantees back.",
      "Here `deduct` requires that the fee is not larger than the amount. The program calls it with a fee of 50 and an amount of 30, so the promise is broken and Phil stops.",
      "Real Phil proves these promises before the program runs. The simulator checks them while it runs."
    ],
    "task": "Fix `main` so it only charges the fee when the fee fits, and otherwise hands back the amount untouched. `le(a, b)` means “a is at most b”.",
    "inputs": {
      "amount": "30",
      "fee": "50"
    },
    "code": "callable Deduct(amount : U64, fee : U64) -> U64 {\n  requires fee <= amount;\n  outcomes { success U64 };\n}\n\nfn deduct(amount : U64, fee : U64) -> U64 satisfies Deduct {\n  return amount - fee;\n}\n\ncomponent main(amount : U64, fee : U64) provides U64 {\n  return deduct(amount, fee);\n}\n",
    "solution": "callable Deduct(amount : U64, fee : U64) -> U64 {\n  requires fee <= amount;\n  outcomes { success U64 };\n}\n\nfn deduct(amount : U64, fee : U64) -> U64 satisfies Deduct {\n  return amount - fee;\n}\n\ncomponent main(amount : U64, fee : U64) provides U64 {\n  if le(fee, amount) {\n    return deduct(amount, fee);\n  } else {\n    return amount;\n  };\n}\n",
    "starts": "contract",
    "check": {
      "returns": "30",
      "hunt": true
    }
  },
  {
    "id": "linear",
    "chapter": "Ownership",
    "title": "A coin can be spent once",
    "text": [
      "This is the idea Phil is built around. A value marked `mode linear` must be used **exactly once**. It cannot be copied and it cannot be forgotten.",
      "That is how a token should behave. Here `spend` takes a coin apart and hands back its amount. The program then tries to spend the same coin again."
    ],
    "task": "Remove the double spend so the program hands back 10.",
    "code": "record Coin mode linear {\n  amount : U64\n}\n\ncallable Spend(coin : Coin) -> U64 {\n  outcomes { success U64 };\n}\n\nfn spend(coin : Coin) -> U64 satisfies Spend {\n  let Coin { amount } = coin;\n  return amount;\n}\n\ncomponent main provides U64 {\n  let coin = construct Coin { amount = 10 };\n  let first = spend(coin);\n  let second = spend(coin);\n  return first + second;\n}\n",
    "solution": "record Coin mode linear {\n  amount : U64\n}\n\ncallable Spend(coin : Coin) -> U64 {\n  outcomes { success U64 };\n}\n\nfn spend(coin : Coin) -> U64 satisfies Spend {\n  let Coin { amount } = coin;\n  return amount;\n}\n\ncomponent main provides U64 {\n  let coin = construct Coin { amount = 10 };\n  let first = spend(coin);\n  return first;\n}\n",
    "starts": "linearity",
    "check": {
      "returns": "10"
    }
  },
  {
    "id": "lost",
    "chapter": "Ownership",
    "title": "A coin cannot be lost",
    "text": [
      "The other half of “exactly once”: a linear value that is never used is also an error. Nothing of value can silently disappear.",
      "This program makes a coin and then forgets about it."
    ],
    "task": "Use the coin: take it apart with `let Coin { amount } = coin;` and hand back the amount.",
    "code": "record Coin mode linear {\n  amount : U64\n}\n\ncomponent main provides U64 {\n  let coin = construct Coin { amount = 10 };\n  return 0;\n}\n",
    "solution": "record Coin mode linear {\n  amount : U64\n}\n\ncomponent main provides U64 {\n  let coin = construct Coin { amount = 10 };\n  let Coin { amount } = coin;\n  return amount;\n}\n",
    "starts": "linearity",
    "check": {
      "returns": "10"
    }
  },
  {
    "id": "borrow",
    "chapter": "Ownership",
    "title": "Looking without spending",
    "text": [
      "Sometimes you only want to read a coin, not use it up. `borrow coin as c { ... }` lends the coin to a block of code. Inside, `c` can be read. Afterwards the coin is still yours.",
      "This program takes the coin apart to print its amount, and then has nothing left to hand back."
    ],
    "task": "Print the amount using `borrow`, then hand back the coin itself.",
    "code": "record Coin mode linear {\n  amount : U64\n}\n\ncomponent main provides Coin {\n  let coin = construct Coin { amount = 10 };\n  let Coin { amount } = coin;\n  console_write(\"the coin holds\", amount);\n  return coin;\n}\n",
    "solution": "record Coin mode linear {\n  amount : U64\n}\n\ncomponent main provides Coin {\n  let coin = construct Coin { amount = 10 };\n  let amount = borrow coin as c { return c.amount; };\n  console_write(\"the coin holds\", amount);\n  return coin;\n}\n",
    "starts": "linearity",
    "check": {
      "console": "10",
      "returns": "Coin"
    }
  },
  {
    "id": "split",
    "chapter": "Ownership",
    "title": "Splitting a coin",
    "text": [
      "To pay part of a coin you split it in two. `split` takes the coin apart and builds two new ones that add up to the same total. Its promise says you cannot split off more than the coin holds.",
      "The wallet below holds 20, and the program tries to pay 50."
    ],
    "task": "Make `main` safe for any price: pay only when the wallet can cover it. When it can't, hand back the whole wallet. Use `ge(a, b)` for “a is at least b”. A bug hunt must find nothing.",
    "inputs": {
      "price": "50"
    },
    "code": "record Coin mode linear {\n  amount : U64\n}\n\ncallable Split(coin : Coin, part : U64) -> (Coin, Coin) {\n  requires part <= coin.amount;\n  outcomes { success (Coin, Coin) };\n}\n\nfn split(coin : Coin, part : U64) -> (Coin, Coin) satisfies Split {\n  let Coin { amount = total } = coin;\n  return (construct Coin { amount = part }, construct Coin { amount = total - part });\n}\n\ncomponent main(price : U64) provides Coin {\n  let wallet = construct Coin { amount = 20 };\n  let (payment, change) = split(wallet, price);\n  let Coin { amount = paid } = payment;\n  console_write(\"paid\", paid);\n  return change;\n}\n",
    "solution": "record Coin mode linear {\n  amount : U64\n}\n\ncallable Split(coin : Coin, part : U64) -> (Coin, Coin) {\n  requires part <= coin.amount;\n  outcomes { success (Coin, Coin) };\n}\n\nfn split(coin : Coin, part : U64) -> (Coin, Coin) satisfies Split {\n  let Coin { amount = total } = coin;\n  return (construct Coin { amount = part }, construct Coin { amount = total - part });\n}\n\ncomponent main(price : U64) provides Coin {\n  let wallet = construct Coin { amount = 20 };\n  if ge(20, price) {\n    let (payment, change) = split(wallet, price);\n    let Coin { amount = paid } = payment;\n    console_write(\"paid\", paid);\n    return change;\n  } else {\n    return wallet;\n  };\n}\n",
    "starts": "contract",
    "check": {
      "returns": "Coin",
      "hunt": true
    }
  },
  {
    "id": "ping",
    "chapter": "Conversations",
    "title": "Two programs, one script",
    "text": [
      "Programs in Phil talk over a **protocol**: a script that says who sends what, in which order. Each side gets a `role`, and the two roles must mirror each other.",
      "A connection is linear too. Every `send` or `receive` uses up the connection and gives you the next one, so a program cannot skip a step or repeat one.",
      "The `architecture` at the bottom wires things together: which components exist, which protocol connects them, and what goes in."
    ],
    "task": "Extend the script: after receiving `x`, the server sends back a `U8` reply, and the client prints it with `console_write(\"reply\", ...)`. Both roles and both components need to change.",
    "inputs": {
      "payload": "42"
    },
    "code": "protocol Ping {\n  role Client = send (x : U8) then end Done;\n  role Server = receive (x : U8) then end Done;\n}\n\ncomponent ClientWorker(endpoint : Client[Ping], payload : U8) {\n  // send consumes the endpoint and returns its successor\n  let done = send payload on endpoint;\n  close done;\n}\n\ncomponent ServerWorker(endpoint : Server[Ping]) {\n  let (done, received) = receive U8 on endpoint;\n  console_write(\"server received\", received);\n  close done;\n}\n\narchitecture LocalPing {\n  instance client = ClientWorker;\n  instance server = ServerWorker;\n  process client_run = client;\n  process server_run = server;\n  protocol ping = Ping;\n  role ping.Client = client;\n  role ping.Server = server;\n  entry payload : U8;\n  bind client.endpoint = ping.Client;\n  bind client.payload = payload;\n  bind server.endpoint = ping.Server;\n}\n\nprogram main = instantiate LocalPing;\n",
    "solution": "protocol Ping {\n  role Client = send (x : U8) then receive (y : U8) then end Done;\n  role Server = receive (x : U8) then send (y : U8) then end Done;\n}\n\ncomponent ClientWorker(endpoint : Client[Ping], payload : U8) {\n  // send consumes the endpoint and returns its successor\n  let waiting = send payload on endpoint;\n  let (done, reply) = receive U8 on waiting;\n  console_write(\"reply\", reply);\n  close done;\n}\n\ncomponent ServerWorker(endpoint : Server[Ping]) {\n  let (replyTo, received) = receive U8 on endpoint;\n  console_write(\"server received\", received);\n  let done = send received on replyTo;\n  close done;\n}\n\narchitecture LocalPing {\n  instance client = ClientWorker;\n  instance server = ServerWorker;\n  process client_run = client;\n  process server_run = server;\n  protocol ping = Ping;\n  role ping.Client = client;\n  role ping.Server = server;\n  entry payload : U8;\n  bind client.endpoint = ping.Client;\n  bind client.payload = payload;\n  bind server.endpoint = ping.Server;\n}\n\nprogram main = instantiate LocalPing;\n",
    "starts": "ok",
    "check": {
      "console": "reply",
      "messages": 2
    }
  },
  {
    "id": "order",
    "chapter": "Conversations",
    "title": "The script must be followed",
    "text": [
      "A connection can only be closed when its script has reached `end`. Here the client closes straight away, although the script says it must send first.",
      "On a real network this is the bug where one side hangs forever waiting for a message that never comes."
    ],
    "task": "Make the client follow the script: send the payload, then close.",
    "inputs": {
      "payload": "7"
    },
    "code": "protocol Ping {\n  role Client = send (x : U8) then end Done;\n  role Server = receive (x : U8) then end Done;\n}\n\ncomponent ClientWorker(endpoint : Client[Ping], payload : U8) {\n  close endpoint;\n}\n\ncomponent ServerWorker(endpoint : Server[Ping]) {\n  let (done, received) = receive U8 on endpoint;\n  close done;\n}\n\narchitecture LocalPing {\n  instance client = ClientWorker;\n  instance server = ServerWorker;\n  process client_run = client;\n  process server_run = server;\n  protocol ping = Ping;\n  role ping.Client = client;\n  role ping.Server = server;\n  entry payload : U8;\n  bind client.endpoint = ping.Client;\n  bind client.payload = payload;\n  bind server.endpoint = ping.Server;\n}\n\nprogram main = instantiate LocalPing;\n",
    "solution": "protocol Ping {\n  role Client = send (x : U8) then end Done;\n  role Server = receive (x : U8) then end Done;\n}\n\ncomponent ClientWorker(endpoint : Client[Ping], payload : U8) {\n  let done = send payload on endpoint;\n  close done;\n}\n\ncomponent ServerWorker(endpoint : Server[Ping]) {\n  let (done, received) = receive U8 on endpoint;\n  close done;\n}\n\narchitecture LocalPing {\n  instance client = ClientWorker;\n  instance server = ServerWorker;\n  process client_run = client;\n  process server_run = server;\n  protocol ping = Ping;\n  role ping.Client = client;\n  role ping.Server = server;\n  entry payload : U8;\n  bind client.endpoint = ping.Client;\n  bind client.payload = payload;\n  bind server.endpoint = ping.Server;\n}\n\nprogram main = instantiate LocalPing;\n",
    "starts": "protocol",
    "check": {
      "messages": 1
    }
  },
  {
    "id": "reuse",
    "chapter": "Conversations",
    "title": "Each step uses up the connection",
    "text": [
      "After `send 1 on endpoint`, the name `endpoint` is spent. The send hands back a new connection that stands at the next step of the script.",
      "The writer below sends the second byte on the old name."
    ],
    "task": "Send the second byte on the connection the first send handed back.",
    "code": "protocol TwoBytes {\n  role Writer = send (a : U8) then send (b : U8) then end Done;\n  role Reader = receive (a : U8) then receive (b : U8) then end Done;\n}\n\ncomponent Writer(endpoint : Writer[TwoBytes]) {\n  let next = send 1 on endpoint;\n  let done = send 2 on endpoint;\n  close done;\n}\n\ncomponent Reader(endpoint : Reader[TwoBytes]) {\n  let (e1, a) = receive U8 on endpoint;\n  let (e2, b) = receive U8 on e1;\n  close e2;\n}\n\narchitecture Pair {\n  instance w = Writer;\n  instance r = Reader;\n  process w_run = w;\n  process r_run = r;\n  protocol bytes = TwoBytes;\n  role bytes.Writer = w;\n  role bytes.Reader = r;\n  bind w.endpoint = bytes.Writer;\n  bind r.endpoint = bytes.Reader;\n}\n\nprogram main = instantiate Pair;\n",
    "solution": "protocol TwoBytes {\n  role Writer = send (a : U8) then send (b : U8) then end Done;\n  role Reader = receive (a : U8) then receive (b : U8) then end Done;\n}\n\ncomponent Writer(endpoint : Writer[TwoBytes]) {\n  let next = send 1 on endpoint;\n  let done = send 2 on next;\n  close done;\n}\n\ncomponent Reader(endpoint : Reader[TwoBytes]) {\n  let (e1, a) = receive U8 on endpoint;\n  let (e2, b) = receive U8 on e1;\n  close e2;\n}\n\narchitecture Pair {\n  instance w = Writer;\n  instance r = Reader;\n  process w_run = w;\n  process r_run = r;\n  protocol bytes = TwoBytes;\n  role bytes.Writer = w;\n  role bytes.Reader = r;\n  bind w.endpoint = bytes.Writer;\n  bind r.endpoint = bytes.Reader;\n}\n\nprogram main = instantiate Pair;\n",
    "starts": "linearity",
    "check": {
      "messages": 2
    }
  },
  {
    "id": "choice",
    "chapter": "Conversations",
    "title": "Choices and repeats",
    "text": [
      "A script can branch. One side picks with `select`; the other side must be ready for every option with `offer`.",
      "`recursive Loop` lets a script repeat: `continue Loop` goes back to the start. Here the client asks for a number of rounds and then selects `Done`.",
      "Run it, then open the Playground to watch the same program step by step."
    ],
    "task": "Teach the server a new trick: make it reply \"woof\" instead of \"pong\".",
    "inputs": {
      "rounds": "3"
    },
    "code": "protocol PingLoop {\n  role Client = recursive Loop = select {\n    Ping => send (x : U32) then receive (reply : String) then continue Loop |\n    Done => end Done\n  };\n  role Server = recursive Loop = offer {\n    Ping => receive (x : U32) then send (reply : String) then continue Loop |\n    Done => end Done\n  };\n}\n\ncomponent Client(endpoint : Client[PingLoop], rounds : U32) {\n  loop state (ep = endpoint, remaining : U32 = rounds) {\n    if eq(remaining, 0) {\n      let finished = select Done on ep;\n      close finished;\n      break;\n    } else {\n      let chosen = select Ping on ep;\n      let awaiting = send remaining on chosen;\n      let (next, reply) = receive String on awaiting;\n      console_write(\"client got\", reply);\n      continue (next, remaining - 1);\n    };\n  };\n}\n\ncomponent Server(endpoint : Server[PingLoop]) provides U32 {\n  let served = loop state (ep = endpoint, count : U32 = 0) {\n    offer ep {\n      Ping => {\n        let (replyTo, x) = receive U32 on ep;\n        let next = send \"pong\" on replyTo;\n        continue (next, count + 1);\n      }\n      Done => {\n        close ep;\n        break (count);\n      }\n    };\n  };\n  return served;\n}\n\narchitecture Rounds {\n  instance client = Client;\n  instance server = Server;\n  process client_run = client;\n  process server_run = server;\n  protocol ping = PingLoop;\n  role ping.Client = client;\n  role ping.Server = server;\n  entry rounds : U32;\n  bind client.endpoint = ping.Client;\n  bind client.rounds = rounds;\n  bind server.endpoint = ping.Server;\n}\n\nprogram main = instantiate Rounds;\n",
    "solution": "protocol PingLoop {\n  role Client = recursive Loop = select {\n    Ping => send (x : U32) then receive (reply : String) then continue Loop |\n    Done => end Done\n  };\n  role Server = recursive Loop = offer {\n    Ping => receive (x : U32) then send (reply : String) then continue Loop |\n    Done => end Done\n  };\n}\n\ncomponent Client(endpoint : Client[PingLoop], rounds : U32) {\n  loop state (ep = endpoint, remaining : U32 = rounds) {\n    if eq(remaining, 0) {\n      let finished = select Done on ep;\n      close finished;\n      break;\n    } else {\n      let chosen = select Ping on ep;\n      let awaiting = send remaining on chosen;\n      let (next, reply) = receive String on awaiting;\n      console_write(\"client got\", reply);\n      continue (next, remaining - 1);\n    };\n  };\n}\n\ncomponent Server(endpoint : Server[PingLoop]) provides U32 {\n  let served = loop state (ep = endpoint, count : U32 = 0) {\n    offer ep {\n      Ping => {\n        let (replyTo, x) = receive U32 on ep;\n        let next = send \"woof\" on replyTo;\n        continue (next, count + 1);\n      }\n      Done => {\n        close ep;\n        break (count);\n      }\n    };\n  };\n  return served;\n}\n\narchitecture Rounds {\n  instance client = Client;\n  instance server = Server;\n  process client_run = client;\n  process server_run = server;\n  protocol ping = PingLoop;\n  role ping.Client = client;\n  role ping.Server = server;\n  entry rounds : U32;\n  bind client.endpoint = ping.Client;\n  bind client.rounds = rounds;\n  bind server.endpoint = ping.Server;\n}\n\nprogram main = instantiate Rounds;\n",
    "starts": "ok",
    "check": {
      "console": "woof"
    }
  },
  {
    "id": "deadlock",
    "chapter": "Conversations",
    "title": "When nobody can move",
    "text": [
      "Both roles below begin by receiving. Each side waits for the other to speak first, forever. That is a deadlock.",
      "The fix is in the script: the two roles must mirror each other. Where one receives, the other sends."
    ],
    "task": "Change role `B` and the `Right` component so that B sends first and then receives.",
    "code": "protocol Stuck {\n  role A = receive (x : U8) then send (y : U8) then end Done;\n  role B = receive (x : U8) then send (y : U8) then end Done;\n}\n\ncomponent Left(endpoint : A[Stuck]) {\n  let (e1, x) = receive U8 on endpoint;\n  let e2 = send x on e1;\n  close e2;\n}\n\ncomponent Right(endpoint : B[Stuck]) {\n  let (e1, x) = receive U8 on endpoint;\n  let e2 = send x on e1;\n  close e2;\n}\n\narchitecture Standoff {\n  instance left = Left;\n  instance right = Right;\n  process left_run = left;\n  process right_run = right;\n  protocol s = Stuck;\n  role s.A = left;\n  role s.B = right;\n  bind left.endpoint = s.A;\n  bind right.endpoint = s.B;\n}\n\nprogram main = instantiate Standoff;\n",
    "solution": "protocol Stuck {\n  role A = receive (x : U8) then send (y : U8) then end Done;\n  role B = send (x : U8) then receive (y : U8) then end Done;\n}\n\ncomponent Left(endpoint : A[Stuck]) {\n  let (e1, x) = receive U8 on endpoint;\n  let e2 = send x on e1;\n  close e2;\n}\n\ncomponent Right(endpoint : B[Stuck]) {\n  let e1 = send 7 on endpoint;\n  let (e2, y) = receive U8 on e1;\n  close e2;\n}\n\narchitecture Standoff {\n  instance left = Left;\n  instance right = Right;\n  process left_run = left;\n  process right_run = right;\n  protocol s = Stuck;\n  role s.A = left;\n  role s.B = right;\n  bind left.endpoint = s.A;\n  bind right.endpoint = s.B;\n}\n\nprogram main = instantiate Standoff;\n",
    "starts": "deadlock",
    "check": {
      "messages": 2
    }
  },
  {
    "id": "payment",
    "chapter": "Real things",
    "title": "A payment",
    "text": [
      "Now the pieces come together. Alice splits a coin, sends the payment to Bob over a protocol, and gets a receipt back. Bob merges the coin into his savings.",
      "The coin is linear the whole way: when Alice sends it, she no longer has it. There is no moment where both of them own it, and no moment where neither does.",
      "Nothing to fix here. Run it, then change the price to more than the balance and run it again."
    ],
    "inputs": {
      "balance": "100",
      "price": "30",
      "savings": "500"
    },
    "code": "record Coin mode linear {\n  amount : U64\n}\n\ncallable Split(coin : Coin, part : U64) -> (Coin, Coin) {\n  requires part <= coin.amount;   // checked on every call\n  outcomes { success (Coin, Coin) };\n}\n\nfn split(coin : Coin, part : U64) -> (Coin, Coin) satisfies Split {\n  let Coin { amount = total } = coin;   // destructuring consumes the coin\n  return (construct Coin { amount = part }, construct Coin { amount = total - part });\n}\n\ncallable Merge(a : Coin, b : Coin) -> Coin {\n  outcomes { success Coin };\n}\n\nfn merge(a : Coin, b : Coin) -> Coin satisfies Merge {\n  let Coin { amount = x } = a;\n  let Coin { amount = y } = b;\n  return construct Coin { amount = x + y };   // U64 addition never wraps\n}\n\n// The payment conversation: a coin goes one way, a receipt comes back.\nprotocol Payment {\n  role Payer = send (coin : Coin) then receive (receipt : U64) then end Paid;\n  role Payee = receive (coin : Coin) then send (receipt : U64) then end Paid;\n}\n\ncomponent Alice(channel : Payer[Payment], balance : U64, price : U64) provides Coin {\n  let wallet = construct Coin { amount = balance };\n  let (payment, change) = split(wallet, price);\n  let awaiting = send payment on channel;     // the coin moves to Bob\n  let (done, receipt) = receive U64 on awaiting;\n  close done;\n  let kept = borrow change as c { return c.amount; };\n  console_write(\"Alice got a receipt for\", receipt, \"and keeps\", kept);\n  return change;\n}\n\ncomponent Bob(channel : Payee[Payment], savings : U64) provides Coin {\n  let (replyTo, coin) = receive Coin on channel;\n  let paid = borrow coin as c { return c.amount; };\n  let done = send paid on replyTo;\n  close done;\n  return merge(construct Coin { amount = savings }, coin);\n}\n\narchitecture Shop {\n  instance alice = Alice;\n  instance bob = Bob;\n  process alice_run = alice;\n  process bob_run = bob;\n  protocol pay = Payment;\n  role pay.Payer = alice;\n  role pay.Payee = bob;\n  entry balance : U64;\n  entry price : U64;\n  entry savings : U64;\n  bind alice.channel = pay.Payer;\n  bind alice.balance = balance;\n  bind alice.price = price;\n  bind bob.channel = pay.Payee;\n  bind bob.savings = savings;\n}\n\nprogram main = instantiate Shop;\n",
    "starts": "ok"
  },
  {
    "id": "otc",
    "chapter": "Real things",
    "title": "An escrow swap",
    "text": [
      "This is the Phil OTC desk: the program behind the OTC page on this site. A maker locks tokens with a desk and names a price. A taker pays that price or walks away.",
      "Read the two protocols first. Every path through them ends with each coin in exactly one pair of hands. The desk cannot keep the tokens, because Phil would reject a desk that did.",
      "Run it with a wallet of 400, then with a wallet of 100 to see the refund path."
    ],
    "inputs": {
      "selling": "1000",
      "price": "250",
      "wallet": "400",
      "fee_bps": "100"
    },
    "code": OTC_SOURCE,
    "starts": "ok"
  }
];
