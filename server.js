import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, 'store.db');
const db = new Database(dbPath);
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET is required');
const adminEmail = (process.env.ADMIN_EMAIL || 's07273145@gmail.com').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword || adminPassword.length < 10) throw new Error('Set ADMIN_PASSWORD to a strong password of at least 10 characters');
const adminPasswordHash = bcrypt.hashSync(adminPassword, 12);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,price INTEGER NOT NULL,stock INTEGER NOT NULL DEFAULT 0,description TEXT DEFAULT '',image TEXT DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL,utr TEXT,platform TEXT,items_json TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id));
`);

const seed = [
  ['Google Play Gift Card',1000,60,'Google Play gift card for supported purchases.','play'],
  ['Steam Wallet Card',1500,25,'Steam wallet balance for gaming purchases.','steam'],
  ['Amazon Gift Card',2000,30,'Amazon gift card for eligible purchases.','amazon'],
  ['Netflix Gift Card',1200,40,'Netflix gift card for supported plans.','netflix'],
  ['Visa Platinum Card',2999,50,'Premium digital card with fast activation.','visa'],
  ['Mastercard Gold',2499,40,'Premium digital Mastercard option.','mastercard']
];
if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
  const ins = db.prepare('INSERT INTO products(name,price,stock,description,image) VALUES(?,?,?,?,?)');
  const tx = db.transaction(() => seed.forEach(x => ins.run(...x)));
  tx();
}

const sign = payload => jwt.sign(payload, SECRET, { expiresIn: '7d' });
const cookieOptions = { httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', maxAge:7*864e5 };
function auth(req,res,next){ try { const t=req.cookies.aj_token; if(!t) return res.status(401).json({error:'Login required'}); req.user=jwt.verify(t,SECRET); next(); } catch { return res.status(401).json({error:'Invalid or expired session'}); } }
function admin(req,res,next){ if(req.user?.role!=='admin') return res.status(403).json({error:'Admin only'}); next(); }
function cleanEmail(v){ return String(v||'').trim().toLowerCase(); }

app.get('/health',(req,res)=>res.json({ok:true,service:'AURA JINWOO STORE'}));
app.get('/api/config',(req,res)=>res.json({upiId:process.env.STORE_UPI_ID||'',storeName:'AURA JINWOO STORE'}));
app.get('/api/products',(req,res)=>res.json(db.prepare('SELECT id,name,price,stock,description,image FROM products WHERE active=1 ORDER BY id DESC').all()));
app.post('/api/register',(req,res)=>{
  const {name,email,password}=req.body||{}; const e=cleanEmail(email);
  if(!name?.trim()||!e||!password||password.length<8) return res.status(400).json({error:'Name, email and an 8+ character password are required'});
  try { const hash=bcrypt.hashSync(password,12); const x=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name.trim(),e,hash); res.status(201).json({ok:true,userId:x.lastInsertRowid}); }
  catch { res.status(409).json({error:'An account with this email already exists'}); }
});
app.post('/api/login',(req,res)=>{
  const e=cleanEmail(req.body?.email), p=String(req.body?.password||'');
  if(e===adminEmail && bcrypt.compareSync(p,adminPasswordHash)){ res.cookie('aj_token',sign({role:'admin',email:adminEmail}),cookieOptions); return res.json({ok:true,role:'admin',name:'Admin'}); }
  const u=db.prepare('SELECT * FROM users WHERE email=?').get(e);
  if(!u || !bcrypt.compareSync(p,u.password_hash)) return res.status(401).json({error:'Invalid email or password'});
  res.cookie('aj_token',sign({role:'customer',id:u.id,email:u.email,name:u.name}),cookieOptions); res.json({ok:true,role:'customer',name:u.name});
});
app.post('/api/logout',(req,res)=>{res.clearCookie('aj_token');res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json(req.user));

app.post('/api/orders',auth,(req,res)=>{
  if(req.user.role!=='customer') return res.status(403).json({error:'Customer account required'});
  const {items,utr,platform}=req.body||{};
  if(!Array.isArray(items)||!items.length||!String(utr||'').trim()) return res.status(400).json({error:'Items and UTR are required'});
  let total=0; const clean=[];
  const tx=db.transaction(()=>{
    for(const i of items){
      const p=db.prepare('SELECT id,name,price,stock FROM products WHERE id=? AND active=1').get(Number(i.id));
      const qty=Math.max(1,Math.floor(Number(i.qty||1)));
      if(!p || p.stock<qty) throw new Error(`Insufficient stock for ${p?.name||'product'}`);
      total+=p.price*qty; clean.push({id:p.id,name:p.name,price:p.price,qty});
    }
    const x=db.prepare('INSERT INTO orders(user_id,total,status,utr,platform,items_json) VALUES(?,?,?,?,?,?)').run(req.user.id,total,'Pending Verification',String(utr).trim(),String(platform||''),JSON.stringify(clean));
    for(const i of clean) db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(i.qty,i.id);
    return x.lastInsertRowid;
  });
  try { const id=tx(); res.status(201).json({ok:true,orderId:`AJ${id}`,total}); } catch(e){ res.status(400).json({error:e.message}); }
});
app.get('/api/orders',auth,(req,res)=>{
  const rows=req.user.role==='admin' ? db.prepare('SELECT o.*,u.email,u.name FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC').all() : db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json(rows.map(o=>({...o,items:JSON.parse(o.items_json)})));
});

app.get('/api/admin/stats',auth,admin,(req,res)=>res.json({products:db.prepare('SELECT count(*) c FROM products WHERE active=1').get().c,customers:db.prepare('SELECT count(*) c FROM users').get().c,orders:db.prepare('SELECT count(*) c FROM orders').get().c,revenue:db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status='Paid / Confirmed'").get().s}));
app.get('/api/admin/products',auth,admin,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
app.post('/api/admin/products',auth,admin,(req,res)=>{const {name,price,stock,description,image}=req.body||{}; if(!name?.trim()||!Number.isFinite(+price)) return res.status(400).json({error:'Name and valid price required'}); const x=db.prepare('INSERT INTO products(name,price,stock,description,image) VALUES(?,?,?,?,?)').run(name.trim(),+price,Math.max(0,Math.floor(+stock||0)),description||'',image||'');res.status(201).json({id:x.lastInsertRowid});});
app.put('/api/admin/products/:id',auth,admin,(req,res)=>{const {name,price,stock,description,image,active}=req.body||{};if(!name?.trim()||!Number.isFinite(+price))return res.status(400).json({error:'Invalid product data'});db.prepare('UPDATE products SET name=?,price=?,stock=?,description=?,image=?,active=? WHERE id=?').run(name.trim(),+price,Math.max(0,Math.floor(+stock||0)),description||'',image||'',active?1:0,Number(req.params.id));res.json({ok:true});});
app.delete('/api/admin/products/:id',auth,admin,(req,res)=>{db.prepare('UPDATE products SET active=0 WHERE id=?').run(Number(req.params.id));res.json({ok:true});});
app.patch('/api/admin/orders/:id',auth,admin,(req,res)=>{
  const allowed=['Pending Verification','Paid / Confirmed','Cancelled'];
  const status=req.body?.status;
  if(!allowed.includes(status)) return res.status(400).json({error:'Invalid status'});
  const id=Number(req.params.id);
  const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if(!order) return res.status(404).json({error:'Order not found'});
  if(order.status!=='Cancelled' && status==='Cancelled') {
    const items=JSON.parse(order.items_json);
    const tx=db.transaction(()=>{
      db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,id);
      for(const i of items) db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(i.qty,i.id);
    });
    tx();
  } else {
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,id);
  }
  res.json({ok:true});
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`AURA JINWOO STORE running on http://localhost:${PORT}`));
