 I want to create a UI for adroit from scratch using adroit principles. THis means we create a
  series of heirarchal product decisions and then flesh them out until they are functionally cohenrent and consistent. Then we
  create a series of engineering decisions that informs that. Along the way we can abstract any capabilities that multiple
  parts of the UI need to use. Laslty we define the at rest data models. 
  
  So to start- lets create a new peer directory under the local ledger - UI, 
  and the root story of this product tree is "A user can understand and manipulate an adroit ledger"
I want to try using the adoit methodology to build this tool - so the workflow i envision is:

i make a product decision and you store that decision in the ledger. Then we have a conversation about the implications of that decision or any product refinements. 

For example, in this case i declare we want ao UI - this is the origin story. The most obvious first step is "what does the ui need to do"
- find existing decisions
- navigate the topology of decisions
- toggle between the different types of decisions - product / engineering / capabilities / models
- edit a decision and understand the parts of the tree that may be affected
    - product heirarchy would need to track the child decisions
    - capabilities would need to flag every adherant to that capability
    - model would need to track the same
    - engineering decisions would flag the entire code base - engieering decisions are global by design


so then each of these 4 ideas then gets the same treatment, we consider how to accomplish this in a strictly product sense.


While working through product we may find a place where we want to leverage the decisions made in another tree - such as editing a decision, this would need to potentially happen in a few places. THis is called a capability and we give it a name and a contract - a decision edit capability needs a targety decision, the file it lives in, the text and the context etc. 

This also necessitates we expplicitly model the decision itself so the parts of the UI can handle it.

Lastly we start engineering, this is a series of decisions which may or may not require refinement child decisions. 

for example we decide to write the code in javascript and then this requires we decide a build package or a framework etc.

Then with all of these decisions made we dispatch an agent to write the code to make all of the products work in compliance to the engieering decisions. 

THis will liekly not result in a great product. From there the work is not dictating what should change about the product we dont say "this button shoudl be bigger" or "there should be a big title in this screen", instead we consider what decision is missing that would make that result the logical conclusion. We think about problem solving stragegies themselves, not solving problems. 



