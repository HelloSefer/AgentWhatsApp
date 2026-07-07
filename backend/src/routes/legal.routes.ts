import { Router } from "express";

const router = Router();

const pageStyles = `
  body {
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1.6;
    max-width: 840px;
    margin: 40px auto;
    padding: 0 20px;
    color: #1f2933;
  }
  h1 {
    font-size: 28px;
    margin-bottom: 16px;
  }
  p, li {
    font-size: 16px;
  }
`;

function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${pageStyles}</style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

router.get("/privacy", (_req, res) => {
  res.type("html").send(
    renderPage(
      "Privacy Policy - AgentWhatsApp",
      `<h1>Privacy Policy - AgentWhatsApp</h1>
      <p>This app is used to test a WhatsApp AI sales assistant.</p>
      <p>The app may process WhatsApp messages sent by users to the connected WhatsApp Business number.</p>
      <p>Processed data may include phone number, message content, and order details such as name, city, address, product choices, size, color, and quantity.</p>
      <p>Data is used only to respond to messages, manage sales conversations, and test order collection.</p>
      <p>Data is not sold to third parties.</p>
      <p>Users can request deletion by contacting the app owner.</p>`,
    ),
  );
});

router.get("/data-deletion", (_req, res) => {
  res.type("html").send(
    renderPage(
      "Data Deletion Instructions - AgentWhatsApp",
      `<h1>Data Deletion Instructions - AgentWhatsApp</h1>
      <p>To request deletion of WhatsApp conversation or order test data, contact the app owner by email.</p>
      <p>Include the WhatsApp phone number used in the conversation.</p>
      <p>The app owner will delete associated test data where technically possible.</p>
      <p>Email: contact@example.com</p>
      <p>This email is a placeholder and should be made configurable later.</p>`,
    ),
  );
});

export default router;
