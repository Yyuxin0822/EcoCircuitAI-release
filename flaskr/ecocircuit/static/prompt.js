document.getElementById('header-bar').display = "flex";

// Word counter for description textarea
const textarea = document.getElementById("description");
const wordCountSpan = document.getElementById("word-count");

if (textarea && wordCountSpan) {
  textarea.addEventListener("input", function() {
    const text = textarea.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    wordCountSpan.textContent = words;
    
    // Warn if approaching or exceeding limit
    if (words > 300) {
      wordCountSpan.style.color = "#f00";
      // Trim to approximately 300 words
      const wordsArray = text.split(/\s+/);
      if (wordsArray.length > 300) {
        textarea.value = wordsArray.slice(0, 300).join(" ");
        wordCountSpan.textContent = 300;
      }
    } else if (words > 250) {
      wordCountSpan.style.color = "#fa0";
    } else {
      wordCountSpan.style.color = "#666";
    }
  });
}

document.getElementById('icon-switch').addEventListener('click', switchPrompt);
function switchPrompt() {
    let textInputBox = document.getElementById('text-prompt');
    let imgInputBox = document.getElementById('image-prompt');
    //if text prompt is visible, hide it and show image prompt
    if (textInputBox.style.display !== 'none') {
        textInputBox.style.display = 'none';
        imgInputBox.style.display = 'flex';
    }
    //if image prompt is visible, hide it and show text prompt
    else {
        textInputBox.style.display = 'flex';
        imgInputBox.style.display = 'none';
    }
    // console.log('switched');
}

new SystemBar(document.getElementById('system-bar'))

function previewUpload(fileInput, preview) {
    const originalBorderStyle = '1px solid #ccc';
    var imageprompt = document.getElementById('image-label');
    var spanText = imageprompt.querySelector('span');

    if (fileInput) {
        fileInput.addEventListener('change', function () {
            var file = fileInput.files[0];

            if (!file) {
                clearImagePreview();
                return;
            }

            if (file.size > 4000000) {
                alert('File is too large. Maximum allowed size is 4 MB.');
                fileInput.value = '';
                clearImagePreview();
                return;
            }

            var reader = new FileReader();

            reader.onloadend = function () {
                var img = new Image();

                img.onload = function () {
                    var resizedimension = imageprompt.offsetWidth;
                    var dimension = Math.min(img.width, img.height);
                    var canvas = document.createElement('canvas');
                    canvas.width = resizedimension;
                    canvas.height = resizedimension;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, (img.width - dimension) / 2, (img.height - dimension) / 2, dimension, dimension, 0, 0, resizedimension, resizedimension);
                    preview.src = canvas.toDataURL();
                    preview.style.display = 'block';
                    imageprompt.style.border = 'none';
                    spanText.style.display = 'none';
                    addCloseButton();
                };

                img.onerror = function () {
                    alert('Failed to load image.');
                    imageprompt.style.border = originalBorderStyle;
                };

                img.src = reader.result;
            };

            reader.onerror = function () {
                alert('Failed to read file!');
                imageprompt.style.border = originalBorderStyle;
            };

            reader.readAsDataURL(file);
        });
    }

    function clearImagePreview() {
        preview.src = "";
        preview.style.display = 'none';
        imageprompt.style.border = originalBorderStyle;
        spanText.style.display = 'block';
        removeCloseButton();
    }

    function addCloseButton() {
        // Remove existing close button if any
        removeCloseButton();
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'image-close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            fileInput.value = '';
            clearImagePreview();
        });
        
        imageprompt.appendChild(closeBtn);
    }

    function removeCloseButton() {
        const existingBtn = imageprompt.querySelector('.image-close-btn');
        if (existingBtn) {
            existingBtn.remove();
        }
    }

    // Make clearImagePreview available globally for drag-and-drop
    window.clearImagePreview = clearImagePreview;
}
var fileInput = document.getElementById('image-upload');
var preview = document.getElementById('preview-img');
previewUpload(fileInput, preview);

// Add drag-and-drop functionality
function setupDragAndDrop() {
    const imageLabel = document.getElementById('image-label');
    const spanText = imageLabel.querySelector('span');
    const originalText = spanText.textContent;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        imageLabel.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    // Highlight drop area when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        imageLabel.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        imageLabel.addEventListener(eventName, unhighlight, false);
    });

    // Handle dropped files
    imageLabel.addEventListener('drop', handleDrop, false);

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function highlight(e) {
        imageLabel.classList.add('drag-over');
        spanText.textContent = 'Drop image here';
    }

    function unhighlight(e) {
        imageLabel.classList.remove('drag-over');
        spanText.textContent = originalText;
    }

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            const file = files[0];
            
            // Check if it's an image
            if (!file.type.startsWith('image/')) {
                alert('Please drop an image file.');
                return;
            }

            // Create a new FileList-like object and assign to input
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;

            // Trigger the change event to use existing validation/preview logic
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);
        }
    }
}

// Initialize drag-and-drop when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDragAndDrop);
} else {
    setupDragAndDrop();
}
function seldesel(component) {
    component.addEventListener('click', function () {
        component.classList.toggle('component-bar-custom');
        component.classList.toggle('component-bar-node-selected');
    });
}
let componentBarCustom = document.querySelectorAll('.component-bar-custom:not(#custom)');
componentBarCustom.forEach(seldesel);
let custom = document.getElementById('custom');
attachCustomEvent(custom);
function attachCustomEvent(custom) {
    custom?.addEventListener('blur', function () {
        if (!custom.textContent) {
            return;
        }
        else {
            let customLabel = createCustomLabel(custom.textContent);
            custom.replaceWith(customLabel);
            let customDefault = createCustomDefault();
            customLabel.insertAdjacentElement('afterend', customDefault);
        }
    });
}
function createCustomDefault() {
    let custom = document.getElementById('custom');
    if (!custom) {
        let customDefault = document.createElement('div');
        customDefault.classList.add('component-bar-custom', 'card-14');
        customDefault.id = 'custom';
        customDefault.contentEditable = true;
        attachCustomEvent(customDefault);
        return customDefault;
    }
}
function createCustomLabel(content) {
    let nodeEdited = document.createElement('div');
    nodeEdited.classList.add('node-edited');
    let iconClose2 = document.createElement('span');
    iconClose2.classList.add('icon-common');
    iconClose2.classList.add('icon-close2');
    iconClose2.addEventListener('click', function () {
        nodeEdited.remove();
    });
    let custom = document.createElement('div');
    custom.classList.add('component-bar-node-selected');
    custom.classList.add('card-14');
    custom.id = content;
    custom.textContent = content;
    seldesel(custom);
    nodeEdited.appendChild(iconClose2);
    nodeEdited.appendChild(custom);
    return nodeEdited;
}
function finishEdit(event) {
    if (event.key === "Enter" || event.keyCode === 13) {
        event.preventDefault();
        event.target.blur();
    }
}
addGlobalEventListener('keydown', '[contenteditable]', finishEdit);


document.getElementById('start-thinking')?.addEventListener('click', function () {
    //if window.socket is not connected, connect to it
    if (!window.socket || !window.socket.connected) {
        window.socket.connect();
    }
    let textPrompt = document.getElementById('text-prompt');
    let imagePrompt = document.getElementById('image-prompt');

    if (textPrompt.style.display !== 'none') {
        let descriptionValue = document.getElementById('description').value;

        if (descriptionValue) {
            window.socket.emit('receiving/prompt', {
                description: descriptionValue,
                requesttype: 'description',
                system: JSON.stringify(window.defaultSystems)
            });
            startLoad();
        } else {
            alert('Please enter a description.');
            return;
        }
    }

    if (imagePrompt.style.display !== 'none') {
        let fileInput = document.getElementById('image-upload');

        if (!fileInput || fileInput.files.length === 0) {
            alert('Please browse file to upload an image.');
            return;
        }

        let file = fileInput.files[0];
        let reader = new FileReader();

        reader.onload = function (event) {
            window.socket.emit('receiving/prompt', {
                image: event.target.result, // base64 encoded image
                filename: file.name,
                requesttype: 'image',
                system: JSON.stringify(window.defaultSystems)
            });
            startLoad();
        };

        reader.readAsDataURL(file);
    }

    window.socket.on('prompt_response', function (msg) {
        if (msg.status === 'success') {
            window.location.href = msg.redirect_url;
        } else {
            alert(msg.error);
        }
    });

    // Listen for progress updates
    window.socket.on("progress_update", (data) => {
        console.log(data.message, data.percent + "%");
        updateLoaderText(data.message, data.percent);
    });
});


