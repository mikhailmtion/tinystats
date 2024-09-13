function main() {
  // last-n slider
  const last_n_slider = document.querySelector(".last-n-slider");
  const last_n = document.querySelector(".last-n");
  if (last_n_slider.value == 0) {
    last_n.textContent = "All";
  } else {
    last_n.textContent = Number(last_n_slider.value) +
      Number(last_n_slider.step);
  }

  // connect to websocket
  // const socket = new WebSocket("wss://tinymod.dev:10000");
  const socket = new WebSocket("ws://localhost:10000");
  console.log("Connecting to websocket");

  // reload the page when the websocket errors or closes
  socket.onerror = (error) => {
    console.error("WebSocket error: ", error);
    // reload the page
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };
  socket.onclose = (event) => {
    console.log("WebSocket closed: ", event);
    // reload the page
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  };

  // state
  const charts = {};
  let currCommit = "";
  let lastUpdateTime = Date.now();
  let runCommitMap = {};

  function reload_charts() {
    for (const card of document.querySelectorAll(".stat-card")) {
      if (card.hasAttribute("data-charted")) {
        observer.unobserve(card);
        observer.observe(card);
        card.removeAttribute("data-charted");
      }
    }
    lastUpdateTime = Date.now();
  }

  // last-n slider event listener
  last_n_slider.addEventListener("input", (event) => {
    if (event.target.value == last_n_slider.max) {
      last_n.textContent = "All";
    } else {
      last_n.textContent = Number(last_n_slider.value) +
        Number(last_n_slider.step);
    }

    reload_charts();
  });

  socket.onmessage = (event) => {
    // split event.data on first space
    // first part is status code
    // second part is data
    const data = JSON.parse(event.data);
    if ("error" in data) {
      console.error("ws api error: ", data.error);
      return;
    }

    if ("benchmarks" in data) {
      console.log(data);
      // generate integer only chart ticks for the x axis
      const x_ticks = [];
      let lowest_x = Infinity;
      let highest_x = -Infinity;
      for (const benchmark of data.benchmarks) {
        if (benchmark.length == 0) continue;
        if (benchmark[0].x < lowest_x) {
          lowest_x = benchmark[0].x;
        }
        if (benchmark[benchmark.length - 1].x > highest_x) {
          highest_x = benchmark[benchmark.length - 1].x;
        }
      }
      const low = Math.floor(lowest_x / 10) * 10;
      const high = Math.ceil(highest_x / 10) * 10;
      const divisor = (high - low) / 10;
      for (let i = low; i < high; i += divisor) {
        const i_10 = i;
        if (i_10 < lowest_x || i_10 > highest_x) continue;
        x_ticks.push(i_10);
      }

      // modify data if we want 1 over data
      if (data.filename.includes("llama")) {
        for (const benchmark of data.benchmarks) {
          for (const point of benchmark) {
            point.y = 1 / point.y * 1000;
            point.y = Math.round(point.y * 100) / 100;
          }
        }
      }

      // update chart
      charts[`${data.filename}-${data.system}`].update({
        series: data.benchmarks,
      }, {
        showPoint: true,
        showLine: true,
        showArea: true,
        lineSmooth: false,
        axisX: {
          type: Chartist.FixedScaleAxis,
          ticks: x_ticks,
          high: highest_x,
          low: lowest_x,
        },
      });
    } else if ("curr-commit" in data) {
      const lastUpdated = document.querySelector("#last-updated");
      lastUpdated.textContent = new Date(Date.now() - lastUpdateTime)
        .toISOString().slice(11, 19);
      if (currCommit === data["curr-commit"]) return;
      const commitElem = document.querySelector("#curr-commit");
      commitElem.textContent = data["curr-commit"].slice(0, 7);
      commitElem.href = `https://github.com/tinygrad/tinygrad/commit/${
        data["curr-commit"]
      }`;
      currCommit = data["curr-commit"];

      reload_charts();
      socket.send("get-run-commit-map");
    } else if ("run-commit-map" in data) {
      runCommitMap = data["run-commit-map"];
      console.log(runCommitMap);
    }
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const filename = entry.target.getAttribute("data-filename");
      const system = entry.target.getAttribute("data-system");

      if (entry.isIntersecting) {
        // check if there is a chart already
        if (!entry.target.hasAttribute("data-charted")) {
          charts[`${filename}-${system}`] = new Chartist.Line(
            `#chart-${filename.replace(/\.[^/.]+$/, "")}-${system}`,
            [],
            {
              plugins: [
                Chartist.plugins.hoverline(),
              ],
            },
          );

          let last_n_v = Number(last_n_slider.value) +
            Number(last_n_slider.step);
          if (last_n_v > Number(last_n_slider.max)) {
            last_n_v = 0;
          }

          socket.send(
            `get-benchmark ${filename} ${system} ${last_n_v}`,
          );

          entry.target.setAttribute("data-charted", true);
        }
      }
    });
  }, {
    threshold: 0.25,
  });

  socket.onopen = () => {
    console.log("Connected to websocket");
    socket.send("get-curr-commit");
    setInterval(() => {
      socket.send("get-curr-commit");
    }, 2000);
    for (const card of document.querySelectorAll(".stat-card")) {
      observer.observe(card);
    }
  };

  (function (window, document, Chartist) {
    "use strict";

    Chartist.plugins = Chartist.plugins || {};
    Chartist.plugins.hoverline = function () {
      return function hoverline(chart) {
        const $chart = chart.container;
        let $lineIsShown = false;
        let $lineFrozen = false;

        let $line = $chart.querySelector(".chartist-hoverline");
        if (!$line) {
          $line = document.createElement("div");
          $line.className = "chartist-hoverline";
          const $box = document.querySelector(".hoverline-box");
          $line.appendChild($box.cloneNode(true));
          $chart.appendChild($line);
        }

        hide($line);

        $chart.addEventListener("mouseover", function () {
          show($line);
        });

        $chart.addEventListener("mouseout", function () {
          if (!$lineFrozen) {
            hide($line);
          }
        });

        $chart.addEventListener("mousemove", function (event) {
          if ($lineIsShown && !$lineFrozen) {
            // locate the closest point on the x-axis
            const eventX = event.layerX || event.offsetX;
            let target, points;
            if (chart instanceof Chartist.Line) {
              target = event.target.ownerSVGElement || event.target;
              points = target.querySelectorAll(".ct-point");
            }
            let closest;
            if (points.length > 0) {
              closest = Array.from(points).reduce((prev, curr) => {
                if (!prev) return curr;
                const prevDelta = Math.abs(prev.x1.baseVal.value - eventX);
                const currDelta = Math.abs(curr.x1.baseVal.value - eventX);
                return prevDelta < currDelta ? prev : curr;
              });
            }
            // find all the points with the same x
            let sameX = [];
            if (points.length > 1) {
              sameX = Array.from(points).filter((point) => {
                return point.x1.baseVal.value === closest.x1.baseVal.value;
              });
            }
            // locate the first points on the x-axis
            let firstPoints = [];
            if (points.length > 0) {
              firstPoints = Array.from(points).filter((point) => {
                return point.x1.baseVal.value === points[0].x1.baseVal.value;
              });
            }

            setPosition(event, sameX, firstPoints);
          }
        });

        $chart.addEventListener("click", function () {
          if ($lineFrozen) {
            thaw($line);
          } else {
            freeze($line);
          }
        });

        function setPosition(event, points, firstPoints) {
          const width = $line.offsetWidth;
          const offsetX = -width / 2;

          const offsetBox = $chart.getBoundingClientRect();
          const allOffsetLeft = -offsetBox.left - window.pageXOffset + offsetX;

          if (points.length > 0) {
            const anchorLeft = points[0].x2.baseVal.value + offsetBox.left +
              window.pageXOffset;
            $line.style.left = anchorLeft + allOffsetLeft + "px";

            const commitElem = $line.querySelector(".hoverline-commit");
            const commit =
              runCommitMap[points[0].getAttribute("ct:value").split(",")[0]];
            if (commit === undefined) {
              commitElem.textContent = "unknown";
            } else {
              commitElem.textContent = commit.slice(0, 7);
              commitElem.href =
                `https://github.com/tinygrad/tinygrad/commit/${commit}`;
            }

            let firstName = "red";
            const chartSystem = $chart.parentElement.getAttribute("data-system");
            if (chartSystem == "comma") {
              firstName = "comma";
            } else if (chartSystem == "usage") {
              firstName = "usage";
            }

            $line.querySelector(".hoverline-run").textContent =
              points[0].getAttribute("ct:value").split(",")[0];
            // get the absolute values
            $line.querySelector("#delta-value").textContent = "";
            for (let i = 0; i < points.length; i++) {
              const value = points[i].getAttribute("ct:value").split(",")[1];
              if (i === 0) {
                $line.querySelector("#delta-value").textContent += `${firstName}: ${value}\n`;
              } else if (i === 1) {
                $line.querySelector("#delta-value").textContent += `green: ${value}\n`;
              } else if (i === 2) {
                $line.querySelector("#delta-value").textContent += `mac: ${value}`;
              }
            }
            // get the deltas from the previous points
            $line.querySelector("#delta-from-prev").textContent = "";
            for (let i = 0; i < points.length; i++) {
              const curr = points[i].getAttribute("ct:value").split(",")[1];
              const prev = (points[i].previousElementSibling.getAttribute("ct:value") !== null) ? points[i].previousElementSibling.getAttribute("ct:value").split(",")[1] : curr;
              const delta = curr - prev;
              const deltaFromPrev = ((delta / prev) * 100).toFixed(2);
              if (i === 0) {
                $line.querySelector("#delta-from-prev").textContent += `${firstName}: ${deltaFromPrev}%\n`;
              } else if (i === 1) {
                $line.querySelector("#delta-from-prev").textContent += `green: ${deltaFromPrev}%\n`;
              } else if (i === 2) {
                $line.querySelector("#delta-from-prev").textContent += `mac: ${deltaFromPrev}%`;
              }
            }
            // get the deltas from the first points
            $line.querySelector("#delta-from-first").textContent = "";
            for (let i = 0; i < points.length; i++) {
              const curr = points[i].getAttribute("ct:value").split(",")[1];
              const prev = firstPoints[i].getAttribute("ct:value").split(",")[1];
              const delta = curr - prev;
              const deltaFromPrev = ((delta / prev) * 100).toFixed(2);
              if (i === 0) {
                $line.querySelector("#delta-from-first").textContent += `${firstName}: ${deltaFromPrev}%\n`;
              } else if (i === 1) {
                $line.querySelector("#delta-from-first").textContent += `green: ${deltaFromPrev}%\n`;
              } else if (i === 2) {
                $line.querySelector("#delta-from-first").textContent += `mac: ${deltaFromPrev}%`;
              }
            }
          } else {
            $line.style.left = event.pageX + allOffsetLeft + "px";
            $line.querySelector(".hoverline-commit").textContent = "";
            $line.querySelector(".hoverline-run").textContent = "";
            $line.querySelector("#delta-from-prev").textContent = "";
            $line.querySelector("#delta-from-first").textContent = "";
          }
        }

        function show(element) {
          $lineIsShown = true;
          if (!hasClass(element, "hoverline-show")) {
            element.className = element.className + " hoverline-show";
          }
        }

        function hide(element) {
          $lineIsShown = false;
          const regex = new RegExp("hoverline-show" + "\\s*", "gi");
          element.className = element.className.replace(regex, "").trim();
        }

        function freeze(element) {
          $lineFrozen = true;
          if (!hasClass(element, "hoverline-frozen")) {
            element.className = element.className + " hoverline-frozen";
          }
        }

        function thaw(element) {
          $lineFrozen = false;
          const regex = new RegExp("hoverline-frozen" + "\\s*", "gi");
          element.className = element.className.replace(regex, "").trim();
        }
      };
    };

    function hasClass(element, className) {
      return (" " + element.getAttribute("class") + " ").indexOf(
        " " + className + " ",
      ) > -1;
    }
  })(window, document, Chartist);
}

main();
