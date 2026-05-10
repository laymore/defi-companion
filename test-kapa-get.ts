
async function testKapaGet() {
  try {
    const token = '2643a60a-f0f7-410d-8692-72ded74a810f';
    const query = encodeURIComponent('What is Sui Move?');
    const url = `https://api.kapa.ai/v1/query?website_token=${token}&query=${query}`;
    const response = await fetch(url);
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}
testKapaGet();
