import React from "react";
import ReactDOM from "react-dom/client";
import GameWrapper from "./components/GameWrapper.jsx";
import SpamperceptionBlocks from "./components/SpamperceptionBlocks.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GameWrapper taskId="spamperception-blocks-v1">
      <SpamperceptionBlocks />
    </GameWrapper>
  </React.StrictMode>
);
