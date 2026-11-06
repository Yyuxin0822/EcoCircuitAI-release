function flashMessage(msg) {
  const container = document.getElementById("flash-message");
  if (container) {
    container.innerHTML = `${msg}`;
  } else {
    alert(msg);
  }
}

function addGlobalEventListener(type, selector, callback) {
  document.addEventListener(type, e => {
    if (e.target.matches(selector)) callback(e);
  })
}

function addCustomDbclickEventListener(selector, callback, interval = 300) {
  let lastClickTime = 0;
  document.addEventListener('click', (e) => {
    const dot = e.target.closest(selector);
    if (!dot) return; // Exit if clicked element does not match the selector

    const now = Date.now();
    if (now - lastClickTime <= interval) {
      callback(e); // Trigger the custom double-click callback
    }
    lastClickTime = now; // Update the last click time
  });
}

function hexToRGBA(input, opacity) {
  // Check if input is in RGBA format
  if (input.startsWith('rgba')) {
    return input; // Skip if it's already in RGBA format
  }

  // Check if input is in RGB format
  if (input.startsWith('rgb')) {
    // Extract the RGB values
    let rgbValues = input.match(/\d+/g);
    let r = rgbValues[0];
    let g = rgbValues[1];
    let b = rgbValues[2];

    // Return the formatted RGBA color string
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  // If input is in HEX format, remove the hash at the start if it's there
  let hex = input.replace(/^#/, '');

  // Solve 3-digit hex color
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }

  // Parse the hex string into numeric values
  let r = parseInt(hex.substring(0, 2), 16); // Red
  let g = parseInt(hex.substring(2, 4), 16); // Green
  let b = parseInt(hex.substring(4, 6), 16); // Blue

  // Return the formatted RGBA color string
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function validId(nodeName) {
  // Replace problematic characters with dashes and remove leading/trailing non-alphanumeric characters
  return nodeName
    .replace(/[\s,().]+/g, '-') // Replace spaces, commas, and parentheses with dashes
    .replace(/--+/g, '-') // Replace multiple consecutive dashes with a single dash
    .replace(/^-+|-+$/g, '') // Remove leading and trailing dashes
    .replace(/[^\w-]+/g, ''); // Remove any remaining non-word characters (excluding dashes)
}

function parseJson(jsonString) {
  var nodeObject = JSON.parse(jsonString);
  var node = [];
  Object.entries(nodeObject).forEach(([key, value]) => {
    var subnode = [];
    subnode.push(key);
    if (Array.isArray(value)) {
      value.forEach(item => subnode.push(item));
    } else {
      subnode.push(value);
    }
    node.push(subnode);
  });
  return node;
}

function emitSocket(endpoint, data) {

  return new Promise((resolve, reject) => {
    socket.emit(endpoint, data, response => {
      if (response.error) {
        reject(response.error);
      } else {
        resolve(response);
      }
    });
  });
}

function emitSocketCallback(endpoint, data, callback) {
  socket.emit(endpoint, data, (response) => {
    if (callback) callback(response);
  });
}

// Example Use
// emitSocketCallback('test_connection', { message: 'Testing socket' }, (response) => {
//   if(response.error) {
//     console.error('Connection Test Error:', response.error);
//   } else {
//     console.log('Connection Test Success:', response);
//     // alert(response.message);
//   }
// });


function generateSid() {
  return crypto.randomUUID();
}

function startLoad(id, message = "") {
  const loader = document.createElement("div");
  loader.className = 'loader';

  const spinner = document.createElement("div");
  spinner.className = 'loader-spinner';

  const loaderText = document.createElement("div");
  loaderText.className = 'loader-text';
  loaderText.textContent = message;

  loader.appendChild(spinner);
  loader.appendChild(loaderText);

  const parentDom = id ? document.getElementById(id) : document.body;

  if (!parentDom) {
    console.error(`Element with id "${id}" not found`);
    return;
  }

  // Save current overflow style
  parentDom.dataset.prevOverflow = parentDom.style.overflow;

  // Disable scrolling
  parentDom.style.overflow = 'hidden';

  if (parentDom !== document.body) {
    parentDom.style.position = 'relative';
  }

  parentDom.appendChild(loader);
}

function finishLoad(id) {
  const parentDom = id ? document.getElementById(id) : document.body;
  const loader = parentDom.querySelector(".loader");

  if (loader) {
    loader.classList.add("loader-hidden");

    loader.addEventListener("transitionend", () => {
      loader.parentElement?.removeChild(loader);

      // Restore previous overflow style after loader is removed
      if (parentDom.dataset.prevOverflow !== undefined) {
        parentDom.style.overflow = parentDom.dataset.prevOverflow;
        delete parentDom.dataset.prevOverflow;
      }
    }, { once: true });
  } else {
    // Immediately restore overflow if no loader found
    if (parentDom.dataset.prevOverflow !== undefined) {
      parentDom.style.overflow = parentDom.dataset.prevOverflow;
      delete parentDom.dataset.prevOverflow;
    }
  }
}




// Function to dynamically show text with loader (optional)
function updateLoaderText(message, percent = null) {
  document.querySelectorAll('.loader').forEach(loaderElement => {
    let loaderText = loaderElement.querySelector('.loader-text');

    if (!loaderText) {
      loaderText = document.createElement('div');
      loaderText.className = 'loader-text';
      loaderElement.style.position = 'relative'; // ensures loader is positioned relative
      loaderText.style.position = 'absolute';
      loaderText.style.top = '60%';
      loaderText.style.left = '50%';
      loaderText.style.transform = 'translate(-50%, -60%)';
      loaderText.style.fontSize = '1.2rem';
      loaderText.style.textAlign = 'center';
      loaderElement.appendChild(loaderText);
    }

    loaderText.textContent = percent !== null ? `${message} (${percent.toFixed(0)}%)` : message;
  });
}


function finishLoad(id) {
  const loader = id
    ? document.querySelector(`#${id} .loader`)
    : document.querySelector(".loader");

  loader?.classList.add("loader-hidden");

  loader?.addEventListener("transitionend", () => {
    loader?.parentElement?.removeChild(loader);
  });
}
