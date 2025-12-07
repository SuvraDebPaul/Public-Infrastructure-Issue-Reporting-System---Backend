require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = process.env.MONGO_URI;
const port = process.env.PORT || 3000;
const app = express();

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
    origin: ["http://localhost:5173"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());

async function run() {
  try {
    const db = client.db("PIIRS");
    const IssuesCollection = db.collection("Issues");

    app.get("/issues", async (req, res) => {
      const result = await IssuesCollection.find().toArray();
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
