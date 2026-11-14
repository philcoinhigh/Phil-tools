// A runnable companion to Phil's official Phase 1 tour (docs/tutorials/tour-phase1.md in
// abiggerhammer/phil). The section titles are the tour's; the summaries and the complete
// programs are ours. Every program is run by test/tour.ts.
export interface Part { label?: string; code: string; inputs?: Record<string, string>; expect: "runs" | "declares" | "stops"; kind?: string; shows?: string; returns?: string; note?: string; tryit?: string }
export interface Stop { n: number; title: string; idea: string; parts: Part[]; see?: [string, string][] }
export const TOUR_URL = "https://github.com/abiggerhammer/phil/blob/main/docs/tutorials/tour-phase1.md";
/** The anchor GitHub gives a heading. */
export const anchor = (s: Stop) => `${s.n}. ${s.title}`.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
export const STOPS: Stop[] = [
 {
  "n": 1,
  "title": "A first Phil component",
  "idea": "A component is the smallest thing that runs. It says what it hands back, and it must hand back exactly that.",
  "parts": [
   {
    "code": "component main provides Unit {\n  console_write(\"a Phil component ran\");\n  return unit;\n}\n",
    "expect": "runs",
    "shows": "a Phil component ran",
    "tryit": "Change the text, or make it hand back something that is not `unit`, and see what Phil says."
   }
  ]
 },
 {
  "n": 2,
  "title": "Types say more than how many bits a value occupies",
  "idea": "A record groups named fields. A `data` type is one of several shapes, and the program must deal with every shape before it can go on.",
  "parts": [
   {
    "label": "Records, choices and `match`",
    "code": "record Point {\n  x : U32,\n  y : U32\n}\n\ndata MaybeByte = None | Some(U8);\n\ncomponent main provides U32 {\n  let origin = construct Point {\n    x = 3,\n    y = 4,\n  };\n  let found = Some(convert 7 to U8);\n  match found {\n    None => {\n      console_write(\"nothing there\");\n      return origin.x;\n    }\n    Some(byte) => {\n      console_write(\"found a byte:\", byte);\n      return origin.x + origin.y;\n    }\n  };\n}\n",
    "expect": "runs",
    "shows": "found a byte: 7",
    "tryit": "Replace `Some(convert 7 to U8)` with `None`. Then delete the `None` arm and run it."
   },
   {
    "label": "`decide`: when every shape carries the same kind of value",
    "code": "data Decision = Yes(U32) | No(U32);\n\ncomponent main provides U32 {\n  let choice = Yes(convert 5 to U32);\n  decide choice {\n    Yes(value) => return value;\n    No(value) => return value;\n  };\n}\n",
    "expect": "runs",
    "returns": "5"
   }
  ]
 },
 {
  "n": 3,
  "title": "Some values have ownership rules",
  "idea": "A linear value must be used exactly once. You can look at it without using it up by borrowing it. Branches and loops have to say which values they carry forward.",
  "parts": [
   {
    "label": "A token that can fire once, and a borrow",
    "code": "record FireOnceToken mode linear {\n  id : U64\n}\n\ncomponent main provides U64 {\n  let token = construct FireOnceToken { id = 42 };\n  let seen = borrow token as view {\n    return view.id;\n  };\n  console_write(\"looked at the token without using it up:\", seen);\n  let FireOnceToken { id = used } = token;\n  return used;\n}\n",
    "expect": "runs",
    "returns": "42",
    "tryit": "Delete the line that takes the token apart. Phil will not let a linear value quietly disappear."
   },
   {
    "label": "A branch that says what continues",
    "code": "component main(condition : Bool, x : U32) provides U32 {\n  if condition\n    join state (x_next : U32)\n    invariant x_next == x or x_next == 0\n  {\n    x;\n  } else {\n    0;\n  };\n  return x_next;\n}\n",
    "inputs": {
     "condition": "true",
     "x": "9"
    },
    "expect": "runs",
    "returns": "9",
    "tryit": "Set `condition` to false."
   },
   {
    "label": "A loop that carries a value forward",
    "code": "component main(n : {v : U32 | v > 0}) provides U32 {\n  loop state (i : U32 = n) invariant i > 0 {\n    console_write(\"i is\", i);\n    if gt(i, 1) {\n      continue(i - 1);\n    } else {\n      break;\n    };\n  };\n  return n;\n}\n",
    "inputs": {
     "n": "3"
    },
    "expect": "runs",
    "shows": "i is 1",
    "note": "The tour prints this loop with `if i > 1`. In the published grammar a comparison is a proposition, not an ordinary expression, and we could not derive that line from it, so our checker rejects it. This version asks the same question with `gt(i, 1)`, a helper our simulator provides.",
    "tryit": "Set `n` to 0. The input's own type refuses it before the loop starts."
   }
  ]
 },
 {
  "n": 4,
  "title": "Functions can have public contracts",
  "idea": "A `callable` is a promise about a function, written separately from the function. A function says which promise it keeps, and callers rely on the promise, not the body.",
  "parts": [
   {
    "label": "A contract and a function that satisfies it",
    "code": "callable Identity(x : U32) -> U32 {\n  outcomes { success U32 };\n}\n\nfn identity(x : U32) -> U32 satisfies Identity {\n  return x;\n}\n\ncomponent main provides U32 {\n  return identity(convert 12 to U32);\n}\n",
    "expect": "runs",
    "returns": "12"
   },
   {
    "label": "A function value that can be called once",
    "code": "callable OneShot(x : U32) -> U32 {\n  outcomes { success U32 };\n  outcome success U32 {\n    state ();\n    callee consume;\n  }\n}\n\ncomponent main provides U32 {\n  let f = closure mode linear (x : U32)\n    satisfies OneShot captures () {\n    return x;\n  };\n  return f(convert 8 to U32);\n}\n",
    "expect": "runs",
    "returns": "8",
    "tryit": "Call `f` a second time on the line before `return`."
   }
  ]
 },
 {
  "n": 5,
  "title": "Effects say what a call may do",
  "idea": "A contract lists the kinds of thing a call is allowed to do, such as write to a log. Anything not listed is not allowed.",
  "parts": [
   {
    "code": "callable EffectCarrier() -> Unit {\n  effects {IO, Audit};\n}\n",
    "expect": "declares"
   }
  ]
 },
 {
  "n": 6,
  "title": "Permission is not the same thing as an effect",
  "idea": "An effect says what a call does. An authority says what the caller must be entitled to before making it. Phil keeps the two apart.",
  "parts": [
   {
    "code": "callable StoreOperation() -> Unit {\n  authority {StoreWrite};\n  effects {WriteStore};\n}\n",
    "expect": "declares"
   }
  ]
 },
 {
  "n": 7,
  "title": "Protocols make conversations part of the program",
  "idea": "A protocol writes down who sends what, in what order, from each side's point of view. Each step hands back a new endpoint, so a finished step cannot be repeated.",
  "parts": [
   {
    "code": "protocol Ping {\n  role Client = send (x : U8) then end Done;\n  role Server = receive (x : U8) then end Done;\n}\n\ncomponent ClientWorker(endpoint : Client[Ping], payload : U8) {\n  let done = send payload on endpoint;\n  close done;\n  console_write(\"client: sent\", payload);\n}\n\ncomponent ServerWorker(endpoint : Server[Ping]) {\n  let (done, received) = receive U8 on endpoint;\n  close done;\n  console_write(\"server: received\", received);\n}\n\narchitecture LocalPing {\n  instance client = ClientWorker;\n  instance server = ServerWorker;\n  process client_run = client;\n  process server_run = server;\n  protocol ping = Ping;\n  role ping.Client = client;\n  role ping.Server = server;\n  entry payload : U8;\n  bind client.endpoint = ping.Client;\n  bind client.payload = payload;\n  bind server.endpoint = ping.Server;\n}\n\nprogram main = instantiate LocalPing;\n",
    "inputs": {
     "payload": "7"
    },
    "expect": "runs",
    "shows": "server: received 7",
    "tryit": "In `ServerWorker`, try to receive a second time on `endpoint` after the first receive."
   }
  ]
 },
 {
  "n": 8,
  "title": "Architecture says which parts actually exist",
  "idea": "Components are descriptions. An architecture says which copies of them exist and which ones run. Nothing runs that is not listed.",
  "parts": [
   {
    "code": "component Worker provides Unit {\n  console_write(\"a worker ran\");\n  return unit;\n}\n\narchitecture Pair {\n  instance left = Worker;\n  instance right = Worker;\n  process left_run = left;\n  process right_run = right;\n}\n\nprogram main = instantiate Pair;\n",
    "expect": "runs",
    "shows": "a worker ran",
    "note": "This is the tour's one complete source file, with a line added so that it prints something.",
    "tryit": "Delete one of the two `process` lines and run it again."
   }
  ]
 },
 {
  "n": 9,
  "title": "Phil processes are not OS threads",
  "idea": "A process is a part of the program that takes its own steps. How those steps are interleaved, and what machinery runs them, is not something the source can rely on.",
  "parts": [
   {
    "code": "component Left provides Unit {\n  console_write(\"left: step one\");\n  console_write(\"left: step two\");\n  return unit;\n}\n\ncomponent Right provides Unit {\n  console_write(\"right: step one\");\n  console_write(\"right: step two\");\n  return unit;\n}\n\narchitecture Pair {\n  instance left = Left;\n  instance right = Right;\n  process left_run = left;\n  process right_run = right;\n}\n\nprogram main = instantiate Pair;\n",
    "expect": "runs",
    "shows": "right: step two",
    "note": "Our simulator runs the processes in one fixed order. The playground can replay the others."
   }
  ],
  "see": [
   [
    "Replay other orders in the playground",
    "../playground/"
   ]
  ]
 },
 {
  "n": 10,
  "title": "Some protocol participants can be outside Phil",
  "idea": "One side of a conversation can be marked `external`: something that is not a Phil process, such as another machine. The Phil side is still checked against the protocol.",
  "parts": [
   {
    "code": "protocol Ping {\n  role Client = send (x : U8) then end Done;\n  role Server = receive (x : U8) then end Done;\n}\n\ncomponent ClientWorker(endpoint : Client[Ping], payload : U8) {\n  let done = send payload on endpoint;\n  close done;\n}\n\narchitecture ExternalPeer {\n  instance client = ClientWorker;\n  process client_run = client;\n  protocol ping = Ping;\n  role ping.Client = client;\n  role ping.Server = external;\n  entry payload : U8;\n  bind client.endpoint = ping.Client;\n  bind client.payload = payload;\n}\n\nprogram main = instantiate ExternalPeer;\n",
    "inputs": {
     "payload": "7"
    },
    "expect": "runs",
    "note": "Nothing is on the other end in the simulator, so the message is sent and the run ends."
   }
  ],
  "see": [
   [
    "A real external peer: Phil's server on Solana",
    "../session/"
   ]
  ]
 },
 {
  "n": 11,
  "title": "Providers make implementation replacement explicit",
  "idea": "A provider is a named service contract. Implementations say which contract they satisfy, so swapping one for another is a visible, checked act.",
  "parts": [
   {
    "code": "provider Store {}\n\nprovider implementation MemoryStore satisfies Store {}\n\nopaque provider implementation RemoteStore satisfies Store;\n",
    "expect": "declares"
   }
  ]
 },
 {
  "n": 12,
  "title": "Generic code must say what it needs",
  "idea": "Code that works for many types has to list what it assumes about them: whether a value may be copied, which facts must hold, which services must exist.",
  "parts": [
   {
    "code": "record Routed[T : Type] requires {\n  structural T : duplicate;\n  proposition true;\n  provider P : ProviderContract;\n} {\n  value : T\n}\n",
    "expect": "declares"
   }
  ]
 },
 {
  "n": 13,
  "title": "Phil can carry checked facts in types and contracts",
  "idea": "A type can carry a condition, such as a number that is greater than zero. A value that breaks the condition is stopped at the door.",
  "parts": [
   {
    "code": "claim Positive(x : U32) = x > 0;\n\ncallable KeepPositive(x : {v : U32 | v > 0}) -> U32 {\n  ensures x > 0;\n  outcomes { success U32 };\n}\n\nfn keep(x : {v : U32 | v > 0}) -> U32 satisfies KeepPositive {\n  return x;\n}\n\ncomponent main(n : {v : U32 | v > 0}) provides U32 {\n  return keep(n);\n}\n",
    "inputs": {
     "n": "0"
    },
    "expect": "stops",
    "kind": "contract",
    "tryit": "Set `n` to 5."
   }
  ]
 },
 {
  "n": 14,
  "title": "Bad Phil is rejected before assurance policy gets a vote",
  "idea": "A program that breaks the language's rules is not a program. No setting, policy or override turns it into one.",
  "parts": [
   {
    "code": "record FireOnceToken mode linear {\n  id : U64\n}\n\ncomponent main provides Unit {\n  let token = construct FireOnceToken { id = 1 };\n  return unit;\n}\n",
    "expect": "stops",
    "kind": "linearity",
    "tryit": "Use the token up: `let FireOnceToken { id = used } = token;`"
   }
  ]
 },
 {
  "n": 15,
  "title": "Source verification is not artifact certification",
  "idea": "Checking the source is one claim. Showing that the thing that actually runs matches the source is a separate claim, and needs its own evidence.",
  "parts": [],
  "see": [
   [
    "How we test the emitted code: mutation analysis",
    "../mutation/"
   ],
   [
    "The emitted code, running at both ends",
    "../session/"
   ]
  ]
 },
 {
  "n": 16,
  "title": "Lowering may choose representation, not meaning",
  "idea": "Turning Phil into machine-level code may decide how things are laid out. It may not change what the program means.",
  "parts": [],
  "see": [
   [
    "A Phil program and the LLVM the compiler made from it",
    "../onchain/"
   ]
  ]
 },
 {
  "n": 17,
  "title": "Why stable identity appears at all",
  "idea": "Names in source can change. A `@key` gives a declaration an identity that survives renames, so evidence about it stays attached to the right thing.",
  "parts": [
   {
    "code": "@key(\"decl:upload-id\")\nrecord UploadId {}\n",
    "expect": "declares"
   }
  ]
 },
 {
  "n": 18,
  "title": "How the Ping pieces fit",
  "idea": "Protocol, components and architecture together: the protocol says what may be said, the components say it, and the architecture connects each endpoint to a role.",
  "parts": [
   {
    "code": "protocol Ping {\n  role Client = send (x : U8) then end Done;\n  role Server = receive (x : U8) then end Done;\n}\n\ncomponent ClientWorker(endpoint : Client[Ping], payload : U8) {\n  let done = send payload on endpoint;\n  close done;\n  console_write(\"client: sent\", payload);\n}\n\ncomponent ServerWorker(endpoint : Server[Ping]) {\n  let (done, received) = receive U8 on endpoint;\n  close done;\n  console_write(\"server: received\", received);\n}\n\narchitecture LocalPing {\n  instance client = ClientWorker;\n  instance server = ServerWorker;\n  process client_run = client;\n  process server_run = server;\n  protocol ping = Ping;\n  role ping.Client = client;\n  role ping.Server = server;\n  entry payload : U8;\n  bind client.endpoint = ping.Client;\n  bind client.payload = payload;\n  bind server.endpoint = ping.Server;\n}\n\nprogram main = instantiate LocalPing;\n",
    "inputs": {
     "payload": "200"
    },
    "expect": "runs",
    "shows": "server: received 200",
    "tryit": "Delete the line `bind server.endpoint = ping.Server;`. Then set `payload` to 300, which does not fit in a `U8`."
   }
  ]
 },
 {
  "n": 19,
  "title": "Where the bigger examples fit",
  "idea": "The tour points on to larger programs. These are the larger things we have built and run.",
  "parts": [],
  "see": [
   [
    "An OTC desk with an order book",
    "../otc/"
   ],
   [
    "Token utilities",
    "../library/"
   ],
   [
    "Phil's upload protocol on Solana",
    "../session/"
   ]
  ]
 },
 {
  "n": 20,
  "title": "The ideas to keep",
  "idea": "Values have rules about use. Contracts are public. Conversations are part of the program. Only what the architecture lists exists. Bad programs are rejected, not tolerated.",
  "parts": [],
  "see": [
   [
    "Practise them, with tasks",
    "../learn/"
   ]
  ]
 }
];
