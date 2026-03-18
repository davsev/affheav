const OpenAI = require('openai');
require('dotenv').config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getDayContext() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
  const hour = now.getHours();

  // Saturday night (after Shabbat ends, roughly after 20:00)
  if (day === 6 && hour >= 20) return 'motzei_shabbat';
  // Friday
  if (day === 5) return 'friday';

  return 'regular';
}

async function generateMessage({ Text, Link, join_link }) {
  const dayContext = getDayContext();

  let dayInstruction = '';
  if (dayContext === 'friday') {
    dayInstruction = 'ההודעה נשלחת ביום שישי - הוסף ברכה לשבת בסוף ההודעה.';
  } else if (dayContext === 'motzei_shabbat') {
    dayInstruction = 'ההודעה נשלחת במוצאי שבת - הוסף ברכת שבוע טוב בסוף ההודעה (למשל: "שיהיה לנו שבוע מעולה" או "מי יתן והשבוע נתפוס מלא דגים").';
  }

  const prompt = `נסח הודעת וואטסאפ שיווקית וקצרה למוצר, שמטרתה לעודד רכישה מיידית.

הבסיס להודעה הוא שם המוצר:
${Text}

אם שם המוצר באנגלית - תרגם אותו לעברית ותאר בקצרה מה המוצר עושה ובאיזה צורך יומיומי הוא פותר.

הטקסט צריך:

להישמע טבעי ואנושי, כאילו נשלח ע"י אדם ולא ע"י מערכת

להדגיש תועלת ברורה למשתמש ולא מפרט טכני

לכלול קריאה לפעולה עדינה ולא אגרסיבית

להיות כתוב כפסקה אחת רציפה ללא כותרות או סימונים

שלב כמה אימוג'ים רלוונטיים שמעודדים תשומת לב ורכישה, בלי הגזמה.

שמור על שפת דיבור יום יומית, בלי מילים רשמיות לא מובנות

הוסף שורה ריקה בין תיאור המוצר לבין הקישור לרכישה
ושורה ריקה נוספת בין קישור הרכישה לבין קישור ההצטרפות לקבוצה

בסוף ההודעה הוסף:
קישור למוצר:
${Link}

ובשורה נפרדת בסיום:
קישור להצטרפות לקבוצה:
${join_link}

אל תשתמש במונחים כמו "כותרת", "תיאור", "מודעה" או כל ניסוח טכני אחר.
הטקסט מיועד לקבוצת קונים שמחפשים מוצרים שווים ומועילים.

${dayInstruction}`;

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
  });

  return response.choices[0].message.content.trim();
}

module.exports = { generateMessage };
