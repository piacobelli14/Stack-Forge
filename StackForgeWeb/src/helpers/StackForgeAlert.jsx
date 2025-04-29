import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import "../styles/helperStyles/Alert.css";

function Alert({
  visible,
  title = '',
  message = '',
  inputs = [],
  showCancel = false,
  onConfirm,
  onCancel
}) {
  const initialState = inputs.reduce((acc, input) => {
    acc[input.name] = input.defaultValue || (input.type === 'checkbox' ? false : '');
    return acc;
  }, {});

  const [values, setValues] = useState(initialState);

  useEffect(() => {
    setValues(initialState);
  }, [inputs, visible]);

  if (!visible) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValues({
      ...values,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleConfirm = () => {
    onConfirm && onConfirm(inputs.length ? values : undefined);
  };

  const handleCancel = () => {
    onCancel && onCancel();
  };

  const areAllInputsFilled = () => {
    return inputs.every(input => {
      if (input.type === 'checkbox') {
        return true;
      }
      const value = values[input.name];
      return value !== undefined && value.toString().trim() !== '';
    });
  };

  return (
    <div className="alertOverlay">
      <div className="alertMainWrapper">
        <img className="alertImage" src="./StackForgeLogo.png" alt="" />
        {title && <label className="alertHeader">{title}</label>}
        <label className="alertSubHeader">{message}</label>
        {inputs.length > 0 && inputs.map((input) => (
          <label className="alertInputWrapper" key={input.name}>
            {input.type === 'select' ? (
              <select
                className="alertInput input-select"
                name={input.name}
                value={values[input.name]}
                onChange={handleChange}
                {...(input.attributes || {})}
              >
                {input.options && input.options.map((option, index) => (
                  <option key={index} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={`alertInput input-${input.type || 'text'}`}
                type={input.type || 'text'}
                name={input.name}
                value={input.type === 'checkbox' ? undefined : values[input.name]}
                checked={input.type === 'checkbox' ? values[input.name] : undefined}
                onChange={handleChange}
                {...(input.attributes || {})}
              />
            )}
          </label>
        ))}
        <div className="alertButtonsFlex">
          <button
            className="alertButtons"
            style={{ backgroundColor: "#AD6ADD" }}
            onClick={handleConfirm}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                inputs.length > 0 &&
                areAllInputsFilled()
              ) {
                handleConfirm();
              }
            }}
          >
            OK
          </button>
          {showCancel && (
            <button
              className="alertButtons"
              style={{ backgroundColor: "#D8D8D8", color: "#191919" }}
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function showDialog({ title, message, inputs = [], showCancel = false }) {
  return new Promise((resolve) => {
    window.dispatchEvent(new Event('alertWillShow'));

    const container = document.createElement('div');
    document.body.appendChild(container);

    const cleanup = () => {
      ReactDOM.unmountComponentAtNode(container);
      container.remove();
    };

    const handleConfirm = (values) => {
      resolve(values);
      cleanup();
    };

    const handleCancel = () => {
      resolve(null);
      cleanup();
    };

    ReactDOM.render(
      <Alert
        visible={true}
        title={title}
        message={message}
        inputs={inputs}
        showCancel={showCancel}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />,
      container
    );
  });
}