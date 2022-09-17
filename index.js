const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cddppmw.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'UnAuthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded;
        next();
    });
}

const emailSenderOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY,
        domain: process.env.EMAIL_SENDER_DOMAIN
    }
}

const nodemailerMailgun = nodemailer.createTransport(mg(emailSenderOptions));

function sendAppointmentEmail(booking) {
    const { patient, patientName, treatment, date, slot } = booking;

    var email = {
        from: 'myemail@example.com',
        to: patient,
        subject: `Your Appointment for ${treatment}is on ${date} at ${slot} is Confirmed`,
        text: `Your Appointment for ${treatment}is on ${date} at ${slot} is Confirmed`,
        html: `
        <div>
            <p>Hello ${patientName},</p>
            <h3>Your Appointment for ${treatment} is Confirmed</h3>
            <p>Looking forward to seeing you on ${date} at ${slot}</p>

            <h3>Our Addres</h3>
            <p>Cosmopoliton</p>
            <p>Bangladesh</p>
            <a href="https://web.programming-hero.com/">Unsubscribe</a>
        </div>`
    }

    nodemailerMailgun.sendMail(email, (err, info) => {
        if (err) {
            console.log(err);
        }
        else {
            console.log(info);
        }
    });
}


function sendPaymentConformationEmail(booking) {
    const { patient, patientName, treatment, date, slot } = booking;

    var email = {
        from: 'myemail@example.com',
        to: patient,
        subject: `We have recive your Payment ${treatment}is on ${date} at ${slot} is Confirmed`,
        text: `Your Payment for this Appointment  ${treatment}is on ${date} at ${slot} is Confirmed`,
        html: `
        <div>
            <p>Hello ${patientName},</p>
            <h3>Thank you for your Payment</h3>
            <h3>We have recived you Payment</h3>
            <p>Looking forward to seeing you on ${date} at ${slot}</p>

            <h3>Our Addres</h3>
            <p>Cosmopoliton</p>
            <p>Bangladesh</p>
            <a href="https://web.programming-hero.com/">Unsubscribe</a>
        </div>`
    }

    nodemailerMailgun.sendMail(email, (err, info) => {
        if (err) {
            console.log(err);
        }
        else {
            console.log(info);
        }
    });
}


async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db('doctor_portal').collection('services');
        const bookingCollection = client.db('doctor_portal').collection('bookings');
        const userCollection = client.db('doctor_portal').collection('user');
        const doctorCollection = client.db('doctor_portal').collection('doctors');
        const paymentCollection = client.db('doctor_portal').collection('payments');

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'forbidden' });
            }
        }

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret })
        });


        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services);

        });

        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        })

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === 'admin';
            res.send({ admin: isAdmin });
        })

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET)
            res.send({ result, token });
        })

        //This is not the proper way to query
        //After learning more about mongodb. use aggregate looup, pipeline,match,group
        app.get('/available', async (req, res) => {
            const date = req.query.date;
            //step 1: get all service
            const services = await serviceCollection.find().toArray();
            //step 2: get all the booking that  day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();
            //step 3:for each service 
            services.forEach(service => {
                //step 4:find bookings  for that service.output:[{}, {}, {}, {}]
                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                // step 5:select slots for the service Booking:['','','','']
                const bookedSlots = serviceBookings.map(book => book.slot);
                //step 6:select those slots that are not in bookedSlots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                service.slots = available;
            })
            res.send(services);
        })

        /**
        /* API Naming Convention
         * app.get('/booking')  //get all booking in the collection. or get more than one or by filter
         * app.get('/booking/:id') //get a specific booking
         * app.post('/booking') //add a new booking
         * app.patch('/booking/:id') //for update
         * app.put('/booking/:id') //user thakle update korbe,R user na thakle insert kore: upsert=> update (if exists) or insert (if doesn't exist)
         * app.delete('/booking/:id') //for deleted
         */

        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            }
            else {
                return res.status(403).send({ message: 'Forbidden access' });

            }
        })
        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);

        })
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            console.log("sending email");
            sendAppointmentEmail(booking);
            return res.send({ success: true, result });
        });

        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId,

                }
            };

            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
            res.send(updatedDoc)
        })

        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);

        });

        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);

        });

        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email }
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        })
    }
    finally {

    }
}

run().catch(console.dir);

//For testing

// const email = {
//     from: 'myemail@example.com',
//     to: 'mahamudulhoque92@gmail.com',
//     subject: 'Hey you, awesome!',
//     text: 'Mailgun rocks, pow rifattttttt',
// }

// app.get("/email", async (req, res) => {
//     const booking = req.body;
//     sendAppointmentEmail(booking);
//     res.send({ status: true });

// })


app.get('/', (req, res) => {
    res.send('Hello from doctor uncle');
});

app.listen(port, () => {
    console.log(`Doctor  App listening on port ${port}`);
});



