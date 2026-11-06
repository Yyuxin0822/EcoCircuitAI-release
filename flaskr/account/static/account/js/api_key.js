// Functions available immediately - no waiting for DOMContentLoaded

function attachSubmitAPIKeyListener() {
  const apiKeyForm = document.getElementById('api-key-form');
  if (!apiKeyForm) return; // safety check

  apiKeyForm.addEventListener('submit', function (event) {
    event.preventDefault();  // prevent normal form submission

    const formData = new FormData(apiKeyForm);
    formData.append("from_401", "true"); // Ensure from_401 is explicitly set for AJAX

    fetch('/account/store-key', {
      method: 'POST',
      body: formData
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw data;
        return data;
      })
      .then(data => {
        alert(data.success || 'API Key stored successfully!');
        const errorContainer = document.getElementById("error-container");
        if (errorContainer) {
          errorContainer.innerHTML = "";
        }
        apiKeyForm.dispatchEvent(
          new CustomEvent("apiKey:stored", { detail: data })
        );
      })
      .catch(errorData => {
        const message = (errorData && errorData.error)
          ? errorData.error
          : 'An error occurred. Please try again.';
        alert(message);
      });
  });
}

async function deleteApiKey() {


  const response = await fetch("/account/api-key-crud", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },

  });

  if (response.ok) {
    const apiKeyElem = document.getElementById("api-key-value");
    apiKeyElem.textContent = "No API Key set";

    alert("API Key deleted successfully.");
  } else {
    const err = await response.json().catch(() => null);
    alert("Failed to delete API Key. " + (err?.message || "Please try again."));
  }
}

// Only DOM-dependent initialization waits for DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  // Setup consent checkbox validation
  const consentCheckbox = document.getElementById("consentCheckbox");
  if (consentCheckbox) {
    consentCheckbox.addEventListener("invalid", function () {
      this.setCustomValidity("Please read and agree to our terms and privacy policy to continue.");
    });
    consentCheckbox.addEventListener("change", function () {
      this.setCustomValidity("");
    });
  }

  // Setup API key form submission
  if (typeof attachSubmitAPIKeyListener === 'function') {
    attachSubmitAPIKeyListener();
  }
  
  // Setup event handler for successful storage
  const form = document.getElementById("api-key-form");
  if (form) {
    form.addEventListener("apiKey:stored", (e) => {
      document.getElementById("api-key-value").textContent = e.detail.api_key_preview || "xxxxxxxx";
      form.reset();
      document.getElementById("api-key-display").style.display = "block";
      document.getElementById("new-api-key-container").style.display = "none";
    });
  }

  // Setup API key display/form toggle
  const displayDiv = document.getElementById("api-key-display");
  const formDiv = document.getElementById("new-api-key-container");
  const newBtn = document.getElementById("new-api-key");
  const cancelBtn = document.getElementById("cancel-new-api-key");

  if (newBtn) {
    newBtn.addEventListener("click", () => {
      formDiv.style.display = "block";
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      formDiv.style.display = "none";
      displayDiv.style.display = "block";
    });
  }

});
