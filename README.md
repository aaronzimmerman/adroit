How do we leverage the power of agentic coding to move fast and feel confident in what we are doing?

By moving our work into the domain of decision making. And we persist those decisions as a primary artifact.

Engineering has always been more about making decisions than writing code. It was just that we were doing both and the amount of time it took to write the code dominated the day to day. So decision making was often grandfathered into the code as part of the process. But with agents writing the code, I suggest we can work better by moving entirely into the domain of decision making as the primary work items.

Adroit is a framework towards formalizing that decision making process.

Adroit is a product ledger — a lightweight methodology of structuring changes in an app so as to not truncate past decisions by the ones we are making right now. We track those decisions.

## The Ledger

The ledger contains 4 roots:

- product
- engineering
- models
- capabilities

## Product Ledger

Product is the most important one. It contains the decisions about how the application works, in hierarchical refinement.

A node has a self.yaml that states its decision, as well as context and rejected alternatives.

- A decision is something that has clear options — "the app will perform well" is not a decision. "The app is built on Dropwizard" is.
- For example, the UI's ledger root decision is "A user can understand and manipulate an adroit ledger."

A node has multiple nodes alongside the self.yaml. These nodes all answer "how" to the self.yaml's decision.

- The adroit UI has 4 child nodes to the root — describing how the user can change the ledger, read the history of the ledger, present data hierarchically, and explore the ledger.

This structure continues as many levels of "how" refinements are useful. As nuances occur, those decisions are often revisited and new choices are adopted.

## Engineering

Engineering is a similar hierarchy to product, but its decisions apply to EVERY node. A product hierarchy contains decisions that only refer upwards to their parent. Engineering decisions are those that guide the code base as a whole — tech stack, code style, performance requirements, etc.

## Models

Models are the links between multiple product decision leaves. They are DTOs — not the data at rest — but the data as it is USED by users. Models are given their explicit fields and track links to the decisions that rely on them. This is so understanding the implications of changing a view can be done definitively. Every decision that references the view would likely need to be revisited or at least checked for any conflicts before changing a model.

## Capabilities

A capability is technically a product tree that can be grafted onto any place in the product ledger. It answers HOW a thing is done. The utility is that you may want to do that in multiple places. So you can add a capability to any product decision to allow that to not be repeatedly defined.

## To Use

Point an agent at the adroit.md file. Copy the code local and add to path to use the UI — the command "adroit" will open the /ledger directory in a browser.

The agent should start using the ledger and you can use this as the system of record for decisions made through the back and forth of agentic development.

Work with one agent as the orchestrator; that agent will create subagents to actually work on the code — and these agents are given a narrow view of the ledger — only what they need to know. This prevents them from misreading decisions in other parts of the ledger that do not directly apply to their context.

Similarly, the Context attribute is NOT sent to the agents. These are human-only saves so we remember why we did a thing. They are not sent to the agents because that can also cause incorrect conclusions.

## Best Practices

Keep all decisions out of the code, or other artifacts. That creates opportunity for drift.

Verify the decisions are correct.

Review the decisions, scrutinize the code.

Create acceptance testing based on the decisions.
