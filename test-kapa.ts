
async function testKapa() {
  try {
    const response = await fetch('https://api.kapa.ai/v1/query', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-KEY': '2643a60a-f0f7-410d-8692-72ded74a810f'
      },
      body: JSON.stringify({
        query: 'What is Sui Move?'
      })
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}
testKapa();
