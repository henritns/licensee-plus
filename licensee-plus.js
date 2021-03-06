#!/usr/bin/env node
var access = require("fs-access");
var docopt = require("docopt");
var fs = require("fs");
var path = require("path");
var validSPDX = require("spdx-expression-validate");

var USAGE = [
  "Check npm package dependency license metadata and package data from ClearlyDefined against rules.",
  "",
  "Usage:",
  "  licensee-plus [options]",
  "  licensee-plus --license=EXPRESSION [--whitelist=LIST] [options]",
  "",
  "Options:",
  "  --init                         Create a .licensee.json file.",
  "  --corrections                  Use crowdsourced license metadata corrections.",
  "  --license EXPRESSION           Permit licenses matching SPDX expression.",
  "  --whitelist LIST               Permit comma-delimited name@range.",
  "  --requireClearlyDefined        Permit only packages with ClearlyDefined file results",
  "  --requirePackageLicenseMatch   Permit only license results matching standard license metadata",
  "  --errors-only                  Only show NOT APPROVED packages.",
  "  --production                   Do not check devDependencies.",
  "  --ndjson                       Print newline-delimited JSON objects.",
  "  --quiet                        Quiet mode, only exit(0/1).",
  "  -h, --help                     Print this screen to standard output.",
  "  -v, --version                  Print version to standard output."
].join("\n");

var options = docopt.docopt(USAGE, {
  version: require("./package.json").version
});

var cwd = process.cwd();
var configuration;
var configurationPath = path.join(cwd, ".licensee.json");

if (options["--init"]) {
  fs.writeFile(
    configurationPath,
    JSON.stringify(
      {
        license:
          options["--expression"] ||
          "(MIT OR BSD-2-Clause OR BSD-3-Clause OR Apache-2.0)",
        whitelist: options["--whitelist"]
          ? parseWhitelist(options["--whitelist"])
          : { optimist: "<=0.6.1" },
        corrections: false
      },
      null,
      2
    ) + "\n",
    {
      encoding: "utf8",
      flag: "wx"
    },
    function(error) {
      if (error) {
        if (error.code === "EEXIST") {
          die(configurationPath + " already exists.");
        } else {
          die("Could not create " + configurationPath + ".");
        }
      } else {
        process.stdout.write("Created " + configurationPath + ".\n");
        process.exit(0);
      }
    }
  );
} else if (options["--license"] || options["--whitelist"]) {
  configuration = {
    license: options["--license"] || undefined,
    whitelist: options["--whitelist"]
      ? parseWhitelist(options["--whitelist"])
      : {},
    corrections: options["--corrections"],
    requireClearlyDefined: options["--requireClearlyDefined"] ? true : false,
    requirePackageLicenseMatch: options["--requirePackageLicenseMatch"]
      ? true
      : false
  };
  checkDependencies();
} else {
  access(configurationPath, function(error) {
    if (error) {
      die(
        [
          "Cannot read " + configurationPath + ".",
          "Create " + configurationPath + " with licensee-plus --init",
          "or configure with --license and --whitelist.",
          "See licensee-plus --help for more information."
        ].join("\n")
      );
    } else {
      fs.readFile(configurationPath, function(error, data) {
        if (error) {
          die("Error reading " + configurationPath);
        } else {
          try {
            configuration = JSON.parse(data);
          } catch (error) {
            die("Error parsing " + configurationPath);
          }
          checkDependencies();
        }
      });
    }
  });
}

function checkDependencies() {
  configuration.productionOnly = options["--production"];
  configuration.corrections =
    configuration.corrections || options["--corrections"];
  require("./")(configuration, cwd, function(error, dependencies) {
    if (error) {
      die(error.message + "\n");
    } else {
      if (dependencies.length === 0) {
        process.exit(0);
      } else {
        var errorsOnly = !!options["--errors-only"];
        var quiet = !!options["--quiet"];
        var ndjson = !!options["--ndjson"];
        var haveIssue = false;
        dependencies.forEach(function(dependency) {
          if (!dependency.approved) {
            haveIssue = true;
          }
          if (!quiet) {
            if (errorsOnly) {
              if (!dependency.approved) {
                print(dependency, ndjson);
              }
            } else {
              print(dependency, ndjson);
            }
          }
        });
        process.exit(haveIssue ? 1 : 0);
      }
    }
  });
}

function print(dependency, ndjson) {
  if (ndjson) {
    process.stdout.write(toJSON(dependency) + "\n");
  } else {
    process.stdout.write(toText(dependency) + "\n");
  }
}

function toText(result) {
  return (
    result.name +
    "@" +
    result.version +
    "\n" +
    (result.approved
      ? "  Approved by " + (result.whitelisted ? "whitelist" : "rule") + "\n"
      : "  NOT APPROVED\n") +
    (result.apiResult
      ? ""
      : "  No file-level license information found from ClearlyDefined\n") +
    "  License metadata: " +
    displayLicense(result.license) +
    "\n" +
    (result.corrected
      ? result.corrected === "automatic"
        ? "  Corrected: correct-license-metadata\n"
        : "  Corrected: npm-license-corrections\n"
      : "") +
    (result.badLicenseMatches
      ? "  Bad license hits: " + formatBadLicenses(result.badLicenseMatches)
      : "") +
    "  Repository: " +
    formatRepo(result.repository) +
    "\n" +
    "  Homepage: " +
    formatRepo(result.homepage) +
    "\n" +
    "  Author: " +
    formatPerson(result.author) +
    "\n" +
    "  Contributors:" +
    formatPeople(result.contributors) +
    "\n"
  );
}

function toJSON(dependency) {
  var returned = {};
  Object.keys(dependency).forEach(function(key) {
    if (key !== "parent") {
      returned[key] = dependency[key];
    }
  });
  return JSON.stringify(returned);
}

function displayLicense(license) {
  if (typeof license === "string") {
    if (validSPDX(license)) {
      return license;
    } else {
      return 'Invalid SPDX expression "' + license + '"';
    }
  } else if (Array.isArray(license)) {
    return JSON.stringify(license);
  } else {
    return "Invalid license metadata";
  }
}

function formatPeople(people) {
  if (Array.isArray(people)) {
    return (
      "\n" +
      people
        .map(function(person) {
          return "    " + formatPerson(person);
        })
        .join("\n")
    );
  } else if (typeof people === "string") {
    return " " + people;
  } else {
    return " None listed";
  }
}

function formatPerson(person) {
  if (!person) {
    return "None listed";
  } else if (typeof person === "string") {
    return person;
  } else {
    return (
      person.name +
      (person.email ? " <" + person.email + ">" : "") +
      (person.url ? " (" + person.url + ")" : "")
    );
  }
}

function formatRepo(repo) {
  if (repo) {
    if (typeof repo === "string") {
      return repo;
    } else if (repo.hasOwnProperty("url")) {
      return repo.url;
    }
  } else {
    return "None listed";
  }
}

function formatBadLicenses(licenses) {
  return (
    licenses
      .map(function(license) {
        return license.match;
      })
      .join(", ") +
    "\n" +
    licenses
      .map(function(license) {
        return license.files
          .map(function(file) {
            return "    * " + file + " (" + license.match + ")";
          })
          .join("\n");
      })
      .join("\n") +
    "\n"
  );
}

function die(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

function parseWhitelist(string) {
  return string
    .split(",")
    .map(function(string) {
      return string.trim();
    })
    .reduce(function(whitelist, string) {
      var split = string.split("@");
      whitelist[split[0]] = split[1];
      return whitelist;
    }, {});
}
