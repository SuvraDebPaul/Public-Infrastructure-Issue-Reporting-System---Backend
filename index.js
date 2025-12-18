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
  // console.log(token);
  if (!token)
    return res.status(401).send({ message: "No Token Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    // console.log(decoded);
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
    strict: false,
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
      // console.log("User Already Exits---->", !!alreadyExist);

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
      console.log(result);
      res.send(result);
    });

    // Create Staff (Firebase Auth + DB)
    app.post("/users/staff", async (req, res) => {
      try {
        const { name, email, phone, image, password } = req.body;

        // 1. Create Firebase Auth User (Admin SDK)
        const userRecord = await admin.auth().createUser({
          email,
          password,
          displayName: name,
          phoneNumber: phone || undefined,
          photoURL: image || undefined,
        });

        // 2. Prepare DB record
        const staffData = {
          uid: userRecord.uid,
          name,
          email,
          phone,
          image,
          role: "staff",
          isPremium: false,
          subscribedBy: "",
          isBlocked: false,
          blockedBy: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          loggInAt: new Date().toISOString(),
        };

        // 3. Save to MongoDB
        const result = await UsersCollection.insertOne(staffData);

        res.send({
          success: true,
          message: "Staff created successfully",
          uid: userRecord.uid,
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    // Update Staff Information
    app.put("/users/staff/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { name, email, image } = req.body;

        const staff = await UsersCollection.findOne({ _id: new ObjectId(id) });
        if (!staff) {
          return res
            .status(404)
            .send({ success: false, message: "Staff not found" });
        }

        // Update Firebase Auth profile (optional)
        await admin.auth().updateUser(staff.uid, {
          displayName: name,
          email: email,
          photoURL: image || undefined,
        });

        // Update MongoDB record
        const result = await UsersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              name,
              email,
              image,
              updatedAt: new Date().toISOString(),
            },
          }
        );

        res.send({
          success: true,
          message: "Staff updated successfully",
          result,
        });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    // Delete Staff (Firebase Auth + DB)
    app.delete("/users/staff/:id", async (req, res) => {
      try {
        const id = req.params.id;
        // 1. Find staff in DB
        const staff = await UsersCollection.findOne({ _id: new ObjectId(id) });
        if (!staff) {
          return res
            .status(404)
            .send({ success: false, message: "Staff not found" });
        }

        // 2. Delete Firebase Auth user
        await admin.auth().deleteUser(staff.uid);

        // 3. Delete from MongoDB
        await UsersCollection.deleteOne({ _id: new ObjectId(id) });

        res.send({ success: true, message: "Staff deleted successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, error: err.message });
      }
    });

    //Update User Profile
    app.put("/users/update", async (req, res) => {
      const UpdateUser = req.body;
      const { name, email } = UpdateUser;
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

    app.put("/users/block", async (req, res) => {
      const UpdateUser = req.body;
      const { isBlocked, email, blockedBy } = UpdateUser;
      const query = { email };
      await UsersCollection.findOne(query);
      const result = await UsersCollection.updateOne(query, {
        $set: {
          isBlocked,
          blockedBy,
          updatedAt: new Date().toISOString(),
        },
      });
      console.log(result);
      return res.send(result);
    });

    //Get All User
    app.get("/users", verifyJWT, async (req, res) => {
      // console.log(req.tokenEmail);
      const result = await UsersCollection.find().toArray();
      res.send(result);
    });
    //Get a Users Role
    app.get("/users/role", verifyJWT, async (req, res) => {
      const query = { email: req.tokenEmail };
      const result = await UsersCollection.findOne(query);
      res.send(result);
    });
    //Get Single User
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await UsersCollection.findOne(query);
      res.send(result);
    });
    app.get("/issues", async (req, res) => {
      const result = await IssuesCollection.find().toArray();
      res.send(result);
    });
    app.get("/allIssues", async (req, res) => {
      try {
        const {
          search = "",
          category = "",
          status = "",
          priority = "",
          boosted = "",
          sort = "recent",
          page = 1,
          limit = 9,
        } = req.query;

        const query = {};

        if (search) {
          query.$or = [
            { tittle: { $regex: search, $options: "i" } },
            { category: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
          ];
        }

        // FILTERS
        if (category) query.category = category;
        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (boosted === "true") query.boosted = true;

        // SORTING
        let sortQuery = {};
        switch (sort) {
          case "upvotes":
            sortQuery = { upvotes: -1 };
            break;
          case "boosted":
            sortQuery = { boosted: -1, createdAt: -1 };
            break;
          default:
            sortQuery = { createdAt: -1 }; // most recent
        }

        // PAGINATION
        const skip = (page - 1) * limit;

        const cursor = IssuesCollection.find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(Number(limit));

        const issues = await cursor.toArray();
        const totalCount = await IssuesCollection.countDocuments(query);
        const totalPages = Math.ceil(totalCount / limit);

        res.send({
          issues,
          totalPages,
          totalCount,
          currentPage: Number(page),
        });
      } catch (error) {
        console.error("Error fetching issues:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    //Getting Categorylist
    app.get("/issues/categories", async (req, res) => {
      try {
        const categories = await IssuesCollection.distinct("category");
        res.send(categories);
      } catch (error) {
        console.error("Error fetching categories:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    //Getting a Single Issue
    app.get("/issues/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await IssuesCollection.findOne(query);
      console.log(result);
      res.send(result);
    });
    //Updating a Single Issue
    app.put("/issues/:id", async (req, res) => {
      const id = req.params.id;
      const { timeline, ...updatedData } = req.body;
      try {
        const updateObj = { $set: updatedData };
        if (timeline) {
          updateObj.$push = {
            timeline: {
              status: timeline.status,
              message: timeline.message,
              createdAt: new Date().toISOString(),
              updatedBy: timeline.updatedBy,
            },
          };
        }
        const result = await IssuesCollection.updateOne(
          { _id: new ObjectId(id) },
          updateObj
        );
        res.send(result);
      } catch (err) {
        console.log(err);
      }
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
      // console.log(email);
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
      // console.log(paymentType);
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
      // console.log(session);
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
          createdAt: new Date().toISOString(),
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
                  message: `Issue boosted by ${session.customer_email} `,
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
      // console.log(boostAlreadyExist);
      return res.send({ boostAlreadyExist });
    });
    //Get all Payments By a User Email
    app.get("/payments/:email", async (req, res) => {
      const email = req.params.email;
      const query = { paidBy: email };
      const result = await PaymentsCollection.find(query).toArray();
      res.send(result);
    });
    //Get all Payments For Admin
    app.get("/payments", verifyJWT, async (req, res) => {
      const result = await PaymentsCollection.find().toArray();
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
