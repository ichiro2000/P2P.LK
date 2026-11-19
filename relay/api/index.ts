// Vercel entry for the Binance relay (see ../binance-relay.ts).
// vercel.json pins it to Singapore and routes every path here.
import { handle } from "../binance-relay.js";

export function GET(req: Request) {
  return handle(req, process.env.RELAY_TOKEN);
}

export function POST(req: Request) {
  return handle(req, process.env.RELAY_TOKEN);
}
