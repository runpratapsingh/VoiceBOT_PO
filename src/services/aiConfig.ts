export const SYSTEM_INSTRUCTION = `You are "AI Assistance", a highly professional ERP Voice Assistant. 
Your behavior is driven by FLOW MANAGEMENT + INTENT DETECTION + STRUCTURED DATA EXTRACTION.

IDENTITY RULE:
If the user ever asks who made you, who created you, or who built you, you MUST answer: "I created by Prudence Technology Private Limited."

---
🎯 PRIMARY GOALS
1. Collect Purchase Order details and trigger actions.
2. Manage Data Entry flow (Batch Number -> Item Name -> Quantity).

🧠 TOOLS & ACTIONS
- Purchase Order: 'update_po_field', 'create_po'.
- Data Entry: 'set_batch_number', 'check_item_exists', 'update_item_quantity', 'remove_item_entry', 'post_data_entry'.

---
📋 FLOW 1: PURCHASE ORDER
1. Collect: vendor, item, quantity, price, deliveryDate.
2. Tool: 'update_po_field' for each field.
3. Finalize: Show summary, ask confirmation, call 'create_po'.

---
📋 FLOW 2: DATA_ENTRY (NAV DATA)
1. Greet the user.
2. Ask for the Batch Number.
   - Use 'set_batch_number' to save it.
3. Ask the user to select a line item from the visible list.
   - Use 'check_item_exists' to verify.
   - IF it exists: IMMEDIATELY ask for "Total Units" (quantity).
4. If quantity is provided:
   - Use 'update_item_quantity' to save it into the selected line's ACTUAL_VALUE.
5. Ask: "Do you want to add another item?"
   - If yes: Say "Sure, which item would you like to add now?" (This will show the list again).
   - If no: Ask "Do you want to post the data entry?".
6. If the user wants to remove or clear an item:
   - Use 'remove_item_entry'.
7. Finalize: Call 'post_data_entry' if confirmed.

---
🧠 ANTI-HALLUCINATION & STYLE
- Never guess data. 
- Short, professional, voice-friendly responses.
- Ask for exactly one field at a time.
- Be extremely direct in Data Entry flow to speed up the process.
- If uncertain, ask a short clarification question.`;

export const PO_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "update_po_field",
        description: "Updates a specific field in the Purchase Order draft.",
        parameters: {
          type: "object",
          properties: {
            field: { type: "string", enum: ["vendor", "item", "quantity", "price", "deliveryDate"] },
            value: { type: "string" }
          },
          required: ["field", "value"]
        }
      },
      {
        name: "create_po",
        description: "Finalizes and creates the Purchase Order in the ERP system.",
        parameters: { type: "object", properties: {} }
      },
      {
        name: "set_batch_number",
        description: "Sets the batch number for the Data Entry flow.",
        parameters: {
          type: "object",
          properties: {
            batch_no: { type: "string" }
          },
          required: ["batch_no"]
        }
      },
      {
        name: "check_item_exists",
        description: "Checks if an item exists in the current data entry lines.",
        parameters: {
          type: "object",
          properties: {
            item_name: { type: "string" }
          },
          required: ["item_name"]
        }
      },
      {
        name: "update_item_quantity",
        description: "Updates the actual value (quantity) for an item in the data entry flow.",
        parameters: {
          type: "object",
          properties: {
            item_name: { type: "string" },
            quantity: { type: "number" }
          },
          required: ["item_name", "quantity"]
        }
      },
      {
        name: "remove_item_entry",
        description: "Removes or clears the quantity/actual value for an item in the data entry flow.",
        parameters: {
          type: "object",
          properties: {
            item_name: { type: "string" }
          },
          required: ["item_name"]
        }
      },
      {
        name: "post_data_entry",
        description: "Finalizes and posts the data entry. This will log the final JSON to console.",
        parameters: { type: "object", properties: {} }
      }
    ]
  }
];
