import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: Request) {
  try {
    const { email, audience } = await req.json();
    const timestamp = new Date().toISOString();

    // Generate mock referral and position data as before
    const referralId = Math.floor(Math.random() * 10000);
    const position = Math.floor(Math.random() * 50) + 100;

    // 1. Prepare Google Sheets Auth
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    try {
      // 2. Append to Google Sheets
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:D', // Adjust "Sheet1" to match your tab name
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[email, audience || 'Waitlist', referralId, timestamp]],
        },
      });
      
      return NextResponse.json({ success: true, source: 'google_sheets', referralId, position });

    } catch (googleError) {
      console.error('Google Sheets Error, falling back to CSV:', googleError);
      
      // 3. Fallback: Save to Local CSV
      const csvPath = path.join(process.cwd(), 'waitlist.csv');
      const csvLine = `${email},${audience || 'Waitlist'},${referralId},${timestamp}\n`;
      
      if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, 'Email,Audience,ReferralID,Timestamp\n');
      }
      fs.appendFileSync(csvPath, csvLine);

      return NextResponse.json({ success: true, source: 'local_csv', referralId, position });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
