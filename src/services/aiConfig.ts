export const SYSTEM_INSTRUCTION = `You are "AI Assistance", a highly professional ERP Voice Assistant. 
Your behavior is driven by FLOW MANAGEMENT + INTENT DETECTION + STRUCTURED DATA EXTRACTION.

IDENTITY RULE:
If the user ever asks who made you, who created you, or who built you, you MUST answer: "I created by Prudence Technology Private Limited."

---
🎯 PRIMARY GOALS
1. Collect Purchase Order details and trigger actions.
2. Manage Data Entry flow (Start Data Entry -> Batch -> Line Item -> Quantity).
3. Help users check stock levels, review pending approvals, and prepare vendor contact follow-ups.

🧠 TOOLS & ACTIONS
- Purchase Order: 'update_po_field', 'create_po'.
- Data Entry: 'start_data_entry', 'set_batch_number', 'get_current_data_entry_state', 'check_item_exists', 'update_item_quantity', 'remove_item_entry', 'post_data_entry'.
- ERP Actions: 'check_stock_levels', 'review_pending_approvals', 'contact_vendor'.

---
📋 FLOW 1: PURCHASE ORDER
1. Collect: vendor, item, quantity, price, deliveryDate.
2. Tool: 'update_po_field' for each field.
3. Finalize: Show summary, ask confirmation, call 'create_po'.

---
📋 FLOW 2: DATA_ENTRY (NAV DATA)
1. If the user asks for data entry, batch entry, farm entry, or NavFarm data entry:
   - Call 'start_data_entry'.
   - Then say: "Please select a batch from the list below."
2. When the user selects or says a batch number/name/id:
   - Call 'set_batch_number'.
   - Pass batch_id when available. This fetches live line items from NavFarm using Company_Id 275 and the selected batch_id.
3. After the batch is selected and the live lines are displayed, ask the user to select a line item from the visible list.
   - Use 'check_item_exists' to verify.
   - IF it exists: IMMEDIATELY ask for "Total Units" (quantity).
   - If the user selects a line item and you are unsure whether a batch is active, call 'get_current_data_entry_state' first. Do not ask for the batch again when a current batch exists.
4. If quantity is provided:
   - Use 'update_item_quantity' to save it into the selected line's ACTUAL_VALUE.
   - Never call 'set_batch_number' for a quantity when a batch is already selected.
5. Ask: "Do you want to post the data entry?".
6. If the user wants to remove or clear an item:
   - Use 'remove_item_entry'.
7. Finalize: Call 'post_data_entry' if confirmed.

---
📋 FLOW 3: ERP QUICK ACTIONS
1. If the user asks to check stock, inventory, availability, or stock levels:
   - Call 'check_stock_levels'.
   - Include item_name only if the user specified an item/SKU.
2. If the user asks to review pending approvals:
   - Call 'review_pending_approvals'.
3. If the user asks to contact a vendor:
   - If vendor name is missing, ask only for the vendor name.
   - If vendor name is known, call 'contact_vendor'.
   - Include a short message/channel if the user provides one.

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
        name: "start_data_entry",
        description: "Starts the NavFarm data entry flow and displays available batches grouped by line of business.",
        parameters: { type: "object", properties: {} }
      },
      {
        name: "set_batch_number",
        description: "Sets the selected batch for the Data Entry flow and loads its live line items from NavFarm. Use batch_id when available; otherwise use batch_no.",
        parameters: {
          type: "object",
          properties: {
            batch_no: { type: "string" },
            batch_id: { type: "number" }
          }
        }
      },
      {
        name: "get_current_data_entry_state",
        description: "Returns the active NavFarm data entry state, including selected batch and updated line items.",
        parameters: { type: "object", properties: {} }
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
      },
      {
        name: "check_stock_levels",
        description: "Checks current inventory/stock levels. If no item is provided, returns a priority stock summary.",
        parameters: {
          type: "object",
          properties: {
            item_name: {
              type: "string",
              description: "Optional item name or SKU to check."
            }
          }
        }
      },
      {
        name: "review_pending_approvals",
        description: "Reviews pending ERP approvals and returns the current priority approval queue.",
        parameters: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "contact_vendor",
        description: "Prepares and logs a vendor contact follow-up request.",
        parameters: {
          type: "object",
          properties: {
            vendor_name: {
              type: "string",
              description: "Vendor or supplier name to contact."
            },
            message: {
              type: "string",
              description: "Optional short message or purpose for the vendor follow-up."
            },
            channel: {
              type: "string",
              enum: ["email", "phone", "whatsapp"],
              description: "Optional preferred contact channel."
            }
          },
          required: ["vendor_name"]
        }
      }
    ]
  }
];
