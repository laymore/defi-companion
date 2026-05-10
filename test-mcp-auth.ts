
async function testMCPWithAuth() {
  try {
    const response = await fetch('https://sui.mcp.kapa.ai/initialize', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 2643a60a-f0f7-410d-8692-72ded74a810f'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'SuiRobo', version: '1.0.0' }
        }
      })
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}
testMCPWithAuth();
