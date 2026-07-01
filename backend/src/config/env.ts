import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 5000,
  appName: process.env.APP_NAME || "Moroccan Darija WhatsApp AI Sales Agent",
};