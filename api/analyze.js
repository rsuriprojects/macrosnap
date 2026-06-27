export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { imageBase64, imageMimeType, weight, extra } = req.body || {};

  if (!imageBase64) {
    return res.status(400).json({ error: 'No image provided' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY' });
  }

  const hasWeight =
    weight !== undefined && weight !== null && String(weight).trim() !== '';

  const weightInstruction = hasWeight
    ? `The user typed a portion weight of ${weight}g. However, if there is a kitchen/food scale visible in the photo (usually under the plate or bowl) showing a clear weight reading, READ the number off the scale's display and use THAT as the portion weight, since it is more accurate than the typed value. If the scale shows ounces, convert to grams (1 oz = 28.35 g). If no scale reading is clearly legible, use ${weight}g.`
    : `Look carefully for a kitchen/food scale in the photo, usually under the plate or bowl, showing a digital weight reading. READ the number off the scale's display and use it as the portion weight in grams. If the scale shows ounces, convert to grams (1 oz = 28.35 g). If there is no legible scale, estimate the portion weight from the amount of food you can see.`;

  const prompt = `You are a precise nutrition calculator that can also read digital kitchen scales from photos.

Do the following:
1. Identify the food in the photo.
2. Determine the portion weight in grams. ${weightInstruction}
3. Find the nutrition per 100g for that food.
4. Scale the macros to the portion weight (per-100g values multiplied by weight/100).
${extra ? '\nExtra context from the user: ' + extra : ''}

Respond with ONLY a raw JSON object, nothing else. No markdown, no backticks, no commentary.
Include "weight_g" set to the portion weight you actually used, and "scale_read" set to true if you read the weight off a scale in the photo, or false otherwise.
Format: {"food":"name","weight_g":number,"scale_read":boolean,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}`;

  let apiRes;
  try {
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageMimeType || 'image/jpeg',
                  data: imageBase64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to reach Claude API' });
  }

  const data = await apiRes.json();

  if (data.error) {
    return res.status(500).json({ error: data.error.message || 'Claude API error' });
  }

  const raw = (data.content && data.content[0] && data.content[0].text) || '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return res.status(500).json({ error: 'Could not parse nutrition data, try again' });
  }

  let result;
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return res.status(500).json({ error: 'Could not parse nutrition data, try again' });
  }

  const clean = {
    food: String(result.food || 'Unknown food'),
    weight_g: parseFloat(result.weight_g) || (hasWeight ? parseFloat(weight) : 0),
    scale_read: Boolean(result.scale_read),
    calories: parseFloat(result.calories) || 0,
    protein_g: parseFloat(result.protein_g) || 0,
    carbs_g: parseFloat(result.carbs_g) || 0,
    fat_g: parseFloat(result.fat_g) || 0,
  };

  return res.status(200).json(clean);
}
