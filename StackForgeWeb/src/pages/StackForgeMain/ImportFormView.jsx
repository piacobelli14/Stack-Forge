import React, { useState } from "react";
import "../../styles/mainStyles/StackForgeMainStyles/StackforgeImportProjects.css";

const ImportFormView = ({ onClose }) => {
  const [envVars, setEnvVars] = useState([
    { key: "EXAMPLE_NAME", value: "i9U2J3NF394R6HH" }
  ]);

  

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  

  return (
    <div className="importFormOverlay">
      <div className="importFormModal">
        <button className="closeButton" onClick={onClose}>
          ✕
        </button>
        <h1 className="newProjectTitle">New Project</h1>
        <p className="importingFromGithub">
          Importing from GitHub <strong>Nightingale-Health/Vektor-Web-API</strong> | main
        </p>
        <p className="chooseInstructions">
          Choose where you want to create the project and give it a name.
        </p>

        <div className="formRow">
          <label className="formLabel">Vercel Team</label>
          <select className="formSelect">
            <option>Peter Iacabell's projects (Pro)</option>
          </select>
        </div>

        <div className="formRow">
          <label className="formLabel">Project Name</label>
          <input
            type="text"
            defaultValue="vektor-web-api"
            readOnly
            className="formInput"
          />
        </div>

        <div className="formRow">
          <label className="formLabel">Framework Preset</label>
          <select className="formSelect">
            <option>Other</option>
          </select>
        </div>

        <div className="formRow">
          <label className="formLabel">Root Directory</label>
          <div className="rootDirectoryContainer">
            <input
              type="text"
              className="rootDirectoryInput"
              defaultValue="./"
              readOnly
            />
            <button className="editDirectoryButton">Edit</button>
          </div>
        </div>

        <div className="buildAndOutputSection">
          <h2 className="sectionTitle">Build and Output Settings</h2>

          <div className="buildRow">
            <label className="formLabel">Build Command</label>
            <input
              type="text"
              className="formInput"
              placeholder="npm run vercel-build or 'npm run build'"
            />
          </div>

          <div className="buildRow">
            <label className="formLabel">Output</label>
            <input
              type="text"
              className="formInput"
              placeholder="(e.g. dist or build)"
            />
          </div>

          <div className="buildRow">
            <label className="formLabel">Install Command</label>
            <input
              type="text"
              className="formInput"
              placeholder="yarn install, npm install, or bun install"
            />
          </div>
        </div>

        <div className="envVarSection">
          <h2 className="sectionTitle">Environment Variables</h2>

          {envVars.map((item, idx) => (
            <div className="envRow" key={idx}>
              <input
                type="text"
                placeholder="Key"
                className="envKey"
                value={item.key}
                onChange={(e) => {
                  const updated = [...envVars];
                  updated[idx].key = e.target.value;
                  setEnvVars(updated);
                }}
              />
              <input
                type="text"
                placeholder="Value"
                className="envValue"
                value={item.value}
                onChange={(e) => {
                  const updated = [...envVars];
                  updated[idx].value = e.target.value;
                  setEnvVars(updated);
                }}
              />
            </div>
          ))}

          <button className="addMoreButton" onClick={handleAddEnvVar}>
            + Add More
          </button>

          <p className="envTip">
            Tip: Paste an .env above to populate the form.{" "}
            <a href="#" className="learnMoreLink">
              Learn more
            </a>
          </p>
        </div>

        <button className="deployButton">Deploy</button>
      </div>
    </div>
  );
};

export default ImportFormView;
