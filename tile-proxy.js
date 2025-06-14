import express from "express";
import fetch from "node-fetch";

const proxyTileServer = express();
const PORT = 3001;

// Example: /six/NSW_Topo_Map/MapServer/tile/10/1637/2954/jpg
proxyTileServer.get(
  "/six/:mapType/:service/tile/:z/:y/:x",
  async (req, res) => {
    const { mapType, service, z, y, x } = req.params;
    const url = `http://maps.six.nsw.gov.au/arcgis/rest/services/public/${mapType}/${service}/tile/${z}/${y}/${x}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        res.status(response.status).send("Tile not found");
        return;
      }
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Content-Type", response.headers.get("content-type"));
      response.body.pipe(res);
    } catch (err) {
      res.status(500).send("Error fetching tile");
    }
  }
);

proxyTileServer.listen(PORT, () => {
  console.log(`Tile proxy running at http://localhost:${PORT}`);
});
