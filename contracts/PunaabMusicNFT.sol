// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PunaabMusicNFT — one-of-one agent anthem collectibles on Base
/// @notice Minimal ERC-721 with per-token URI; owner-only mintTo
contract PunaabMusicNFT {
    string public name;
    string public symbol;
    address public owner;
    uint256 private _nextTokenId = 1;

    mapping(uint256 => address) private _owners;
    mapping(uint256 => string) private _tokenURIs;
    mapping(address => uint256) private _balances;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "PunaabMusicNFT: not owner");
        _;
    }

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PunaabMusicNFT: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function mintTo(address to, string calldata uri) external onlyOwner returns (uint256 tokenId) {
        require(to != address(0), "PunaabMusicNFT: zero address");
        tokenId = _nextTokenId++;
        _owners[tokenId] = to;
        _tokenURIs[tokenId] = uri;
        _balances[to]++;
        emit Transfer(address(0), to, tokenId);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "PunaabMusicNFT: nonexistent token");
        return _tokenURIs[tokenId];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "PunaabMusicNFT: nonexistent token");
        return tokenOwner;
    }

    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "PunaabMusicNFT: zero address");
        return _balances[account];
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
