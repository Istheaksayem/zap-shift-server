const express = require('express')
const crypto = require('crypto')
const cors = require('cors')
const app = express()
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  //  YYYYMMDD

  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  // 6-char random hex

  return `${prefix}-${date}-${random}`
}

// middleware
app.use(express.json())
app.use(cors())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ba90y0b.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db('zap_shift_db')
    const parcelsCollections = db.collection('parcels')
    const paymentCollection = db.collection('payments')

    // Parcel api
    app.get('/parcels', async (req, res) => {
      const query = {}
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }

      const options = { sort: { createdAt: -1 } }

      const cursor = parcelsCollections.find(query, options)
      const result = await cursor.toArray();
      res.send(result)

    })

    // payment 
    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await parcelsCollections.findOne(query)
      res.send(result)

    })

    app.post('/parcels', async (req, res) => {
      const parcel = req.body;
      // parcel created time
      parcel.createdAt = new Date();
      const result = await parcelsCollections.insertOne(parcel)
      res.send(result)
    })

    // parcel Delete
    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const result = await parcelsCollections.deleteOne(query)
      res.send(result)
    })

    // stripe{payment related api}
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: `please pay for :${paymentInfo.parcelName}`
              },

            },
            quantity: 1,

          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      res.send({ url: session.url })
    })
    // update parcel payment
    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId)


      // console.log('session retrieve', session)

      

      // api 2 bar hit na korar jorno
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId }

      const paymentExist = await paymentCollection.findOne(query)
      console.log(paymentExist)
      if (paymentExist) {

        return res.send
          ({
            message: 'already Exist',
            transactionId,
            trackingId: paymentExist.trackingId
          })
      }


      const trackingId = generateTrackingId()

      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',
            trackingId: trackingId

          }
        }
        const result = await parcelsCollections.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId

        }
        if (session.payment_status === 'paid') {
          const resultPayment = await paymentCollection.insertOne(payment)
          res.send({

            success: true,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            modifyParcel: result,
            paymentInfo: resultPayment
          })
        }

        res.send(result)
      }
      res.send({ success: false })
    })

      // payment related apis(history)
      app.get('/payments',async(req,res) =>{
        const email=req.query.email;
        const query ={}
        if(email){
          query.customerEmail=email;

        }
        const cursor = paymentCollection.find(query)
        const result =await cursor.toArray()
        res.send(result)
      })
    // old
    // app.post('/create-checkout-session', async (req, res) => {
    //   const paymentInfo = req.body;
    //   const amount = parseInt(paymentInfo.cost) * 100
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         // Provide the exact Price ID (for example, price_1234) of the product you want to sell
    //         price_data: {
    //           currency: 'USD',
    //           unit_amount: amount,
    //           product_data: {
    //             name: paymentInfo.parcelName
    //           },

    //         },
    //         quantity: 1,

    //       },
    //     ],
    //     customer_email: paymentInfo.senderEmail,
    //     mode: 'payment',
    //     metadata: {
    //       parcelId: paymentInfo.parcelId
    //     },
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    //   })
    //   console.log(session)
    //   res.send({ url: session.url })
    // })

    // Send a ping to confirm a successful connection

    
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Zap is shifting shifting!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
