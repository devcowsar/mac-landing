import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = process.env.PORT || 3000;
const PUB = path.resolve(__dirname, '..', 'public');
const LEADS_FILE = path.resolve(__dirname, 'leads.json');

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUB, { extensions: ['html'] }));

// Helpers
function readLeads(){
  try{ return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); }
  catch(e){ return []; }
}
function saveLead(lead){
  const leads = readLeads();
  leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

async function maybeEmail(lead){
  const {
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
    NOTIFY_TO, FROM_EMAIL, FROM_LABEL, PDF_LINK
  } = process.env;

  if(!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !NOTIFY_TO || !FROM_EMAIL){
    console.log('[email] SMTP not configured—skipping email.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT||587), secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const subject = lead.type === 'chatbot-consult'
    ? 'New Consultation Request — MAC Landing'
    : 'New Guide Signup — MAC Landing';

  const lines = [
    `Type: ${lead.type}`,
    `Name: ${lead.name || ''}`,
    `Email: ${lead.email || ''}`,
    `Phone: ${lead.phone || ''}`,
    `Message: ${lead.message || ''}`,
    `Qualification: ${lead.qualification ? JSON.stringify(lead.qualification) : ''}`,
    `Created: ${lead.createdAt}`
  ].join('\n');

  // Send to you
  await transporter.sendMail({
    from: `"${FROM_LABEL||'MAC Landing'}" <${FROM_EMAIL}>`,
    to: NOTIFY_TO,
    subject,
    text: lines
  });

  // Auto-reply (guide PDF if available)
  if(lead.type === 'guide-signup'){
    const pdfNote = process.env.PDF_LINK
      ? `\n\nDownload your PDF here:\n${PDF_LINK}\n`
      : '';
    await transporter.sendMail({
      from: `"${FROM_LABEL||'MAC Landing'}" <${FROM_EMAIL}>`,
      to: lead.email,
      subject: 'Your Guide + Webinar Entry (MAC)',
      text:
`Hi ${lead.name||''},

Thanks for requesting “Top 3 Costly Government Contracting Mistakes.”${pdfNote}

You’ve also been entered for our Jan 2026 webinar drawing:
“Mastering Government Submissions: Insider Secrets to Avoid Disqualification & Win More Contracts” (25 seats, $1500 value).

We’ll follow up with details.

— MAC Consulting
contractmac.com`
    });
  }
}

// API
app.post('/api/lead', async (req, res)=>{
  try{
    const { type, name, email, phone, message, qualification, company } = req.body || {};

    // Basic validation + honeypot
    if(company){ return res.status(200).json({ ok:true, message:'Thanks!' }); } // bot trap
    if(!type || !name || !email){
      return res.status(400).json({ message:'Missing required fields.' });
    }
    const lead = {
      type, name, email, phone: phone||'', message: message||'',
      qualification: qualification || null,
      createdAt: new Date().toISOString(),
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
    };
    saveLead(lead);
    await maybeEmail(lead).catch(err=>console.error('[email error]', err));

    return res.json({ ok:true, message:'Lead captured' });
  }catch(e){
    console.error(e);
    return res.status(500).json({ message:'Server error' });
  }
});

// Fallback to SPA
app.get('*', (req, res)=> res.sendFile(path.join(PUB, 'index.html')));

app.listen(PORT, ()=> console.log(`MAC Landing running on http://localhost:${PORT}`));
