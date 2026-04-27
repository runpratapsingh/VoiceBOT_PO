import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const data = await req.json();
    
    // Simulate D365 / Business Central Integration
    console.log("Creating PO in ERP:", data);
    
    // In a real app, you'd fetch() your ERP endpoint here
    // const response = await fetch(process.env.D365_API_URL, { ... })
    
    return NextResponse.json({ 
      success: true, 
      message: "Purchase Order created successfully in Business Central",
      po_number: `PO-${Math.floor(1000 + Math.random() * 9000)}`
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Failed to create PO" }, { status: 500 });
  }
}
