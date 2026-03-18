/**
 * Prompt store — holds the OpenAI prompt template in memory.
 * Editable at runtime via the Settings tab. Resets to default on server restart.
 */

const DEFAULT_PROMPT = `נסח הודעת וואטסאפ שיווקית וקצרה למוצר, שמטרתה לעודד רכישה מיידית.

הבסיס להודעה הוא שם המוצר:
{{Text}}

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
{{Link}}

ובשורה נפרדת בסיום:
קישור להצטרפות לקבוצה:
{{join_link}}

אל תשתמש במונחים כמו "כותרת", "תיאור", "מודעה" או כל ניסוח טכני אחר.
הטקסט מיועד לקבוצת קונים שמחפשים מוצרים שווים ומועילים.

{{dayInstruction}}`;

let currentPrompt = DEFAULT_PROMPT;

function get() {
  return currentPrompt;
}

function set(prompt) {
  currentPrompt = prompt;
}

function reset() {
  currentPrompt = DEFAULT_PROMPT;
}

function getDefault() {
  return DEFAULT_PROMPT;
}

module.exports = { get, set, reset, getDefault };
