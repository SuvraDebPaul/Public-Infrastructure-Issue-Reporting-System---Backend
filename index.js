require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const uri = process.env.MONGO_URI;
const port = process.env.PORT || 3000;
const app = express();

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token)
    return res.status(401).send({ message: "No Token Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//Middlewares
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());

async function run() {
  try {
    const db = client.db("PIIRS");
    const IssuesCollection = db.collection("Issues");
    const PaymentsCollection = db.collection("Payments");
    const UsersCollection = db.collection("Users");

    //Save or Update a User in DB
    app.post("/users", async (req, res) => {
      const userData = req.body;
      userData.role = "citizen";
      userData.isPremium = false;
      userData.subscribedBy = "";
      userData.isBlocked = false;
      userData.blockedBy = "";
      userData.createdAt = new Date().toISOString();
      userData.updatedAt = new Date().toISOString();
      userData.loggInAt = new Date().toISOString();

      const query = { email: userData.email };
      const alreadyExist = await UsersCollection.findOne(query);
      console.log("User Already Exits---->", !!alreadyExist);

      if (alreadyExist) {
        //Updating User Info
        const result = await UsersCollection.updateOne(query, {
          $set: {
            loggInAt: new Date().toISOString(),
          },
        });
        return res.send(result);
      }
      //Saving New User Info
      const result = await UsersCollection.insertOne(userData);
      res.send(result);
    });

    //Update User Profile
    app.put("/users/update", async (req, res) => {
      const UpdateUser = req.body;
      const { name, email } = UpdateUser;
      console.log(name, email);
      const query = { email };
      await UsersCollection.findOne(query);
      const result = await UsersCollection.updateOne(query, {
        $set: {
          name: name,
          updatedAt: new Date().toISOString(),
        },
      });
      return res.send(result);
    });

    //Get a Users Role
    app.get("/users/role", verifyJWT, async (req, res) => {
      console.log(req.tokenEmail);
      const query = { email: req.tokenEmail };
      const result = await UsersCollection.findOne(query);
      res.send(result);
    });

    app.get("/issues", async (req, res) => {
      const result = await IssuesCollection.find().toArray();
      res.send(result);
    });
    //Getting a Single Issue
    app.get("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await IssuesCollection.findOne(query);
      // console.log(result);
      res.send(result);
    });
    //Updating a Single Issue
    app.put("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const result = await IssuesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      res.send(result);
    });
    //Updating Upvotes By Email and Id
    app.put("/issues/upvote/:id", async (req, res) => {
      const { userEmail } = req.body;
      const { id } = req.params;
      // console.log(userEmail);
      // console.log(id);
      const issue = await IssuesCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!issue) return res.status(404).send({ message: "Issue not found" });

      if (issue.upvotedBy.includes(userEmail)) {
        return res.send({ message: "You already upvoted this issue" });
      }

      await IssuesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $inc: { upvotes: 1 },
          $push: { upvotedBy: userEmail },
        }
      );

      res.send({ success: true, message: "Upvote added" });
    });

    // Deleting a Single Issue
    app.delete("/issues/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await IssuesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 1) {
          res.send({ success: true, message: "Issue deleted successfully" });
        } else {
          res.status(404).send({ success: false, message: "Issue not found" });
        }
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .send({ success: false, message: "Failed to delete issue" });
      }
    });
    //Getting Issue according to User Email
    app.get("/all-issues/:email", async (req, res) => {
      const email = req.params.email;
      console.log(email);
      const query = { userEmail: email };
      const result = await IssuesCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/report-issue", async (req, res) => {
      const newIssue = req.body;
      const query = { tittle: newIssue.tittle };
      const alreadyExist = await IssuesCollection.findOne(query);
      if (alreadyExist) {
        // console.log("Already Exits");
        return res.send("Already Exits");
      } else {
        const result = await IssuesCollection.insertOne(newIssue);
        res.send(result);
        // console.log(newIssue);
      }
    });

    //STRIPE PAYMENT CHECKOUT SESSION
    app.post("/create-checkout-session", async (req, res) => {
      const paymentIfo = req.body;
      const paymentType = paymentIfo?.type || "boost";
      console.log(paymentType);
      //Subscribe Payments
      if (paymentType === "subscribe") {
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: 100000,
                product_data: {
                  name: paymentIfo?.name,
                  images: [paymentIfo.image],
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            id: paymentIfo.userId,
            role: paymentIfo?.role,
            type: paymentType,
          },
          customer_email: paymentIfo?.email,
          cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/profile`,
          success_url: `${process.env.CLIENT_DOMAIN}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        });
        res.send({ url: session.url });
      }
      if (paymentType !== "subscribe") {
        //Issue Boosting Payments
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: 10000,
                product_data: {
                  name: paymentIfo?.tittle,
                  description: paymentIfo?.description,
                  images: [paymentIfo.image],
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            id: paymentIfo.id,
            location: paymentIfo?.location,
          },
          customer_email: paymentIfo?.email,
          cancel_url: `${process.env.CLIENT_DOMAIN}/issues/${paymentIfo.id}`,
          success_url: `${process.env.CLIENT_DOMAIN}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        });
        res.send({ url: session.url });
      }
    });

    app.post("/payment/success", async (req, res) => {
      const { sessionId } = req.body;
      // console.log(sessionId);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session);
      const boostAlreadyExist = await PaymentsCollection.findOne({
        transectionId: session.payment_intent,
      });
      if (session.status === "complete" && !boostAlreadyExist) {
        //save order data in db
        const boostInfo = {
          paymentId: session.metadata.id,
          transectionId: session.payment_intent,
          paidBy: session.customer_email,
          paymentType: session.metadata?.type || "boost",
          amount: session.amount_total / 100,
        };
        // console.log(boostInfo);
        const result = await PaymentsCollection.insertOne(boostInfo);

        if (boostInfo.paymentType !== "subscribe") {
          //Update Boost Status
          await IssuesCollection.updateOne(
            {
              _id: new ObjectId(session.metadata.id),
            },
            {
              $set: {
                priority: "High",
                boosted: true,
                boostPaidBy: session.customer_email,
              },
              $push: {
                timeline: {
                  status: "boosted",
                  message: "Issue boosted by user",
                  createdAt: new Date(),
                  updatedBy: session.customer_email,
                },
              },
            }
          );
        }
        if (boostInfo.paymentType === "subscribe") {
          //Update Boost Status
          await UsersCollection.updateOne(
            {
              _id: new ObjectId(session.metadata.id),
            },
            {
              $set: {
                isPremium: true,
                subscribedBy: session.customer_email,
              },
            }
          );
        }
        return res.send({ boostInfo, orderId: result.insertedId });
      }
      console.log(boostAlreadyExist);
      return res.send({ boostAlreadyExist });
    });
    //Get all Payments By a User Email
    app.get("/payments/:email", async (req, res) => {
      const email = req.params.email;
      const query = { paidBy: email };
      const result = await PaymentsCollection.find(query).toArray();
      res.send(result);
    });

    
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is Runing");
});

app.listen(port, () => {
  console.log(`👩‍💻 Server is Running on Port ${port}`);
});
